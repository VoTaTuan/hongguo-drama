const { seasonTitle, sourceOf, findSequels } = require('./watch-history');

const normalizeTitle = title => String(title || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const score = (title, keyword) => !keyword ? 2 : title === keyword ? 0 : title.includes(keyword) ? 1 : 2;
function rankedUnique(results, keyword) {
  const seen = new Set(), normalized = normalizeTitle(keyword);
  return results.filter(item => {
    if (!item?.series_id || !item.series_title) return false;
    const id = String(item.series_id);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).sort((a, b) => score(normalizeTitle(a.series_title), normalized) - score(normalizeTitle(b.series_title), normalized));
}

function nextSeasonQueries(base, season) {
  if (!base || !Number.isInteger(season) || season < 2 || season > 99) return [];
  const digits = '零一二三四五六七八九';
  const chinese = season < 10 ? digits[season] : `${season < 20 ? '' : digits[Math.floor(season / 10)]}十${season % 10 ? digits[season % 10] : ''}`;
  return [`${base}第${chinese}季`, `${base}第${season}季`];
}

// One primary search plus at most two supplements; never recursively expand upstream results.
async function searchSeries(keyword, search, knownSeries = [], { afterSeason = 1, deadline = 0 } = {}) {
  const kw = String(keyword || '').trim();
  if (!kw || kw.length > 200) return { success: false, results: [], error: 'Vui lòng nhập từ khóa tìm kiếm từ 1 đến 200 ký tự' };
  const primary = await search(kw, { fuzzy: true, deadline });
  if (!primary?.success) return primary || { success: false, results: [], error: 'Tìm kiếm tạm thời không khả dụng' };
  const results = [...(primary.results || [])], parsed = seasonTitle(kw);
  let queries = [];
  if (parsed.base && !parsed.invalid && parsed.season <= 99) {
    if (parsed.explicit) {
      if (!results.some(item => normalizeTitle(item.series_title) === normalizeTitle(kw))) queries = [parsed.base];
    } else {
      const seasons = [...results, ...knownSeries].map(item => seasonTitle(item.series_title)).filter(item => item.base === parsed.base && !item.invalid);
      if (seasons.length) {
        const knownSeasons = new Set(seasons.map(item => item.season));
        let nextSeason = afterSeason + 1;
        while (nextSeason <= 99 && knownSeasons.has(nextSeason)) nextSeason++;
        queries = nextSeasonQueries(parsed.base, nextSeason);
      }
    }
  }
  const errors = [];
  for (const query of queries) {
    if (deadline && Date.now() >= deadline) { errors.push('Thời gian tìm kiếm đã hết ngân sách'); break; }
    try {
      const response = await search(query, { fuzzy: false, deadline });
      if (!response?.success) throw new Error(response?.error || 'Nguồn không trả về kết quả');
      results.push(...(response.results || []));
    } catch (error) { errors.push(error.message); }
  }
  const supplementError = errors.length ? `Tìm kiếm bổ sung chưa hoàn thành: ${[...new Set(errors)].join('; ')}` : '';
  const partialErrors = [primary.error, supplementError].filter(Boolean);
  return { ...primary, results: rankedUnique(results, kw), ...(partialErrors.length ? { partial: true, error: partialErrors.join('; ') } : {}) };
}

async function findSeriesSequels(series, localCandidates, search, { localOnly = false, deadline = 0 } = {}) {
  const parsed = seasonTitle(series?.series_title), source = sourceOf(String(series?.series_id || ''));
  if (!source) return { success: false, results: [], error: 'Nguồn này tạm thời chưa hỗ trợ tìm phần tiếp theo, vui lòng tìm kiếm theo tên phim đầy đủ.' };
  if (!parsed.base || parsed.invalid || parsed.season > 99) return { success: false, results: [], error: 'Không thể nhận diện tên phim hoặc số phần, vui lòng tìm kiếm theo tên phim đầy đủ.' };
  const local = findSequels(series, localCandidates);
  if (localOnly) return { success: true, results: local, candidates: local };
  try {
    const response = await searchSeries(parsed.base, search, [series, ...local], { afterSeason: parsed.season, deadline });
    if (!response?.success) throw new Error(response?.error || 'Tìm kiếm nguồn thất bại');
    // Keep the unfiltered candidates so lower seasons in the same family can reuse one search.
    const candidates = [...local, ...(response.results || [])];
    return { success: true, results: findSequels(series, candidates), candidates, ...(response.partial ? { partial: true, error: response.error } : {}) };
  } catch (error) {
    return { success: local.length > 0, results: local, candidates: local, partial: true, error: `Tìm kiếm trực tuyến chưa hoàn thành: ${error.message}${local.length ? '; đã giữ lại danh sách ứng viên trên máy.' : '; có thể thử lại sau.'}` };
  }
}

module.exports = { searchSeries, findSeriesSequels };
