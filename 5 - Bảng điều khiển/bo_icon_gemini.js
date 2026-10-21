// Bộ icon do Gemini thiết kế (2026-10-18), lưới 24x24, nét 1.75, đầu nét bo tròn, chỉ dùng currentColor.
// Cách vẽ: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">GIÁ_TRỊ</svg>
const GEMINI_ICONS = {
  // --- Quản lý & lưu trữ ---
  'folder': '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.38a2.5 2.5 0 0 1 1.77.73l1.2 1.2a1.5 1.5 0 0 0 1.06.44H18.5A2.5 2.5 0 0 1 21 9.87v7.63A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5V7.5Z"/>',
  'folder-plus': '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.38a2.5 2.5 0 0 1 1.77.73l1.2 1.2a1.5 1.5 0 0 0 1.06.44H18.5A2.5 2.5 0 0 1 21 9.87v7.63A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5V7.5Z"/><path d="M12 11v5M9.5 13.5h5"/>',
  'box': '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.25l8 4.5"/>',
  'grid': '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  'queue': '<rect x="4" y="4" width="16" height="5" rx="2"/><path d="M6 13h12M8 17.5h8"/>',
  'move': '<path d="M9 17H5.5A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4h3.38a2 2 0 0 1 1.42.59l1.12 1.12c.38.37.89.58 1.42.58H17.5A2.5 2.5 0 0 1 20 8.8v1.7"/><path d="M13 16h8m0 0-3-3m3 3-3 3"/>',
  // --- Thời trang & media ---
  'shirt': '<path d="M8.5 4 4 6.5 5.5 11 8 9.5V19a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 19V9.5l2.5 1.5L20 6.5 15.5 4a3.5 3.5 0 0 1-7 0Z"/>',
  'user': '<circle cx="12" cy="8" r="4"/><path d="M5 19.5c1.5-3.2 4.1-4.5 7-4.5s5.5 1.3 7 4.5"/>',
  'image': '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m20.5 15.5-4.3-4.3a2 2 0 0 0-2.8 0L6 18.5"/>',
  'film': '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M7.5 3.5v17M16.5 3.5v17M3.5 12h17M3.5 8h4M3.5 16h4M16.5 8h4M16.5 16h4"/>',
  'video': '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 4.2-2.3a.8.8 0 0 1 1.2.7v6.2a.8.8 0 0 1-1.2.7L16 13.5"/>',
  'clapper': '<path d="M4 11h16v7.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V11Zm0 0V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5V11M8.5 4l2.5 7M14.5 4 17 11"/>',
  'sparkle': '<path d="M12 3c.5 4.2 2.8 6.5 7 7-4.2.5-6.5 2.8-7 7-.5-4.2-2.8-6.5-7-7 4.2-.5 6.5-2.8 7-7Z"/><path d="M18.5 16.5v3M17 18h3M5.5 4.5v2M4.5 5.5h2"/>',
  // --- Trạng thái & chọn lọc ---
  'check': '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3 4.7-4.8"/>',
  'check-square': '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="m8.5 12.5 2.3 2.3 4.7-4.8"/>',
  'warning': '<path d="M10.3 4.5a2 2 0 0 1 3.4 0l6.5 11.5a2 2 0 0 1-1.7 3H5.5a2 2 0 0 1-1.7-3l6.5-11.5Z"/><path d="M12 9.5v4M12 16.5h.01"/>',
  'hourglass': '<path d="M6.5 4h11M6.5 20h11M7.5 4v2.5c0 2.5 2 4.2 4.5 5.5 2.5-1.3 4.5-3 4.5-5.5V4M7.5 20v-2.5c0-2.5 2-4.2 4.5-5.5 2.5 1.3 4.5 3 4.5 5.5V20"/>',
  // --- Điều hướng & thao tác ---
  'home': '<path d="M4.5 10.2 12 4l7.5 6.2v8.3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8.3Z"/><path d="M9.5 20.5v-6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6"/>',
  'back': '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  'close': '<path d="M18 6 6 18M6 6l12 12"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'undo': '<path d="M4.5 9.5h9a5 5 0 0 1 0 10H10"/><path d="M8 6 4.5 9.5 8 13"/>',
  // --- Công cụ & hành động ---
  'send': '<path d="m20.2 4.5-15.5 6a.8.8 0 0 0-.1 1.5l6.4 2.5 2.5 6.4a.8.8 0 0 0 1.5-.1l6-15.5a.6.6 0 0 0-.8-.8Z"/><path d="m11 14.5 9-9.8"/>',
  'sliders': '<path d="M4 7h9m4 0h3M15 7a2 2 0 1 0 0-.01M4 17h3m4 0h9M9 17a2 2 0 1 0 0-.01"/>',
  'trash': '<path d="M4.5 6.5h15M9.5 6.5v-1a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v1M6.5 6.5l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-11.6M10 11v5M14 11v5"/>',
  'broom': '<path d="m19.5 4.5-6 6M11 8.5l4.5 4.5-5.2 6.2a1.5 1.5 0 0 1-2.2.1l-3.4-3.4a1.5 1.5 0 0 1 .1-2.2L11 8.5ZM7 14l2.5 2.5"/>',
  'pencil': '<path d="M15.8 4.7a2.1 2.1 0 0 1 3 3L8.5 18l-4 1 1-4L15.8 4.7ZM14 6.5l3 3"/>',
  'link': '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l2.8-2.8a4.5 4.5 0 0 0-6.4-6.4L11.3 6.3"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-2.8 2.8a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  'upload': '<path d="M12 15V4m0 0L8 8m4-4 4 4"/><path d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
  'download': '<path d="M12 4v11m0 0-4-4m4 4 4-4"/><path d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2"/>',
  'play': '<path d="M7 5.6v12.8a1 1 0 0 0 1.5.9l11-6.4a1 1 0 0 0 0-1.8l-11-6.4A1 1 0 0 0 7 5.6Z"/>',
  'pause': '<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>',
  'message': '<path d="M12 20c4.7 0 8.5-3.4 8.5-7.6S16.7 4.8 12 4.8 3.5 8.2 3.5 12.4c0 2 .9 3.8 2.3 5.2L4.5 20l3.7-.7c1.2.4 2.4.7 3.8.7Z"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  'moon': '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
  // --- 4 chấm trạng thái: hào quang mờ + lõi đặc, ăn theo currentColor ---
  'status-online': '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" opacity="0.22"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  'status-offline': '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" opacity="0.18"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  'status-pending': '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" opacity="0.24"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
  'status-error': '<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" opacity="0.24"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>'
};
// màu chấm trạng thái gợi ý (sáng / tối)
const STATUS_COLORS = {
  online: { light: '#10B981', dark: '#34D399' },
  offline: { light: '#94A3B8', dark: '#64748B' },
  pending: { light: '#F59E0B', dark: '#FBBF24' },
  error: { light: '#EF4444', dark: '#F87171' }
};
