const BUILTIN_SOURCES = [
  { id: 'hongguo', label: 'Hồng Quả' }, { id: 'xifan', label: 'XiFan' }, { id: 'hema', label: 'Hà Mã' },
];

function getMediaSources(settings) {
  return [
    ...BUILTIN_SOURCES.filter(source => source.id === 'hongguo' || settings.builtin_sources?.[source.id] !== false),
    ...(settings.custom_sources || []).filter(source => source.enabled).map(source => ({ id: `custom:${source.id}`, label: source.name, custom: true })),
  ];
}

function setBuiltinSourceEnabled(settings, id, enabled) {
  if (id === 'hongguo') throw new Error('Nguồn Hồng Quả được cố định bật, không thể tắt');
  if (!['xifan', 'hema'].includes(id) || typeof enabled !== 'boolean') throw new Error('Công tắc nguồn không hợp lệ');
  return { ...settings, builtin_sources: { ...settings.builtin_sources, [id]: enabled } };
}

module.exports = { getMediaSources, setBuiltinSourceEnabled };
