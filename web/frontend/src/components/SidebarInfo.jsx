import React from 'react';

const SidebarInfo = ({ parcel }) => {
  if (!parcel) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        <h3>Thông tin thửa đất</h3>
        <p>Vui lòng di chuột vào một lô đất trên bản đồ để xem chi tiết.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px', height: '100%' }}>
      <h2 style={{ borderBottom: '2px solid #ccc', paddingBottom: '10px', margin: 0 }}>
        Chi tiết thửa đất
      </h2>

      <div className="info-card" style={{ overflowY: 'auto', flex: 1, paddingRight: '5px' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {Object.entries(parcel).map(([key, value]) => {
            if (key === '_layerRef') return null; // Bỏ qua thuộc tính nội bộ
            return (
              <li key={key} style={{ padding: '8px 0', borderBottom: '1px solid #eee', wordBreak: 'break-word' }}>
                <strong>{key}:</strong> {value !== null && value !== undefined ? String(value) : 'N/A'}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default SidebarInfo;
