import React from 'react';
import './ErrorBoundary.css';

export default class ErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="error-boundary">
      <div role="alert">
        <h1>Đã xảy ra lỗi giao diện</h1>
        <p>Vui lòng tải lại để tiếp tục sử dụng. Nếu vẫn gặp thông báo này, hãy đóng và mở lại ứng dụng.</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Tải lại trang</button>
    </main>;
  }
}
