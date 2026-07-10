import React, { useState, useEffect } from 'react';
import './SidebarEditor.css';

const SidebarEditor = ({ selectedParcels, originalData, onApplyEdits }) => {
  const [propertiesSchema, setPropertiesSchema] = useState({});
  const [editedValues, setEditedValues] = useState({});
  const [modifiedKeys, setModifiedKeys] = useState(new Set());

  useEffect(() => {
    // Chỉ khởi tạo lại schema khi đang trống (tức là khi vừa chọn thửa đầu tiên)
    if (selectedParcels.length > 0 && Object.keys(propertiesSchema).length === 0) {
      const firstParcel = selectedParcels[0];
      const wardData = originalData[
        firstParcel.ward === 'TAY_HIEU' ? 'tayHieu' : 
        firstParcel.ward === 'DONG_HIEU' ? 'dongHieu' : 'thaiHoa'
      ];
      
      if (wardData && wardData.features) {
        const feature = wardData.features.find(f => {
           const id = f.properties?.THUAID || f.properties?.OBJECTID;
           return id === firstParcel.id;
        });
        
        if (feature && feature.properties) {
          const props = { ...feature.properties };
          delete props._layerRef; // Xóa thuộc tính nội bộ
          setPropertiesSchema(props);
          // KHÔNG tự động fill giá trị của thửa đầu tiên vào textboxes nữa
          setEditedValues({});
          setModifiedKeys(new Set());
        }
      }
    } else if (selectedParcels.length === 0) {
      // Khi bỏ chọn hết, clear state
      setPropertiesSchema({});
      setEditedValues({});
      setModifiedKeys(new Set());
    }
  }, [selectedParcels, originalData, propertiesSchema]);

  const handleChange = (key, val) => {
    setEditedValues(prev => ({ ...prev, [key]: val }));
    setModifiedKeys(prev => {
      const newSet = new Set(prev);
      newSet.add(key);
      return newSet;
    });
  };

  const handleApply = () => {
    // Chỉ lọc ra những field mà user thực sự đã gõ/sửa
    const updatesToApply = {};
    modifiedKeys.forEach(key => {
      // Bỏ qua nếu giá trị bị xóa trắng nhưng ta có thể vẫn muốn lưu giá trị rỗng.
      // Tùy theo logic, nếu modified thì gửi lên backend ghi đè.
      updatesToApply[key] = editedValues[key];
    });

    if (Object.keys(updatesToApply).length === 0) {
      alert("Bạn chưa điền vào bất kỳ thuộc tính nào để cập nhật!");
      return;
    }

    onApplyEdits(updatesToApply);
  };

  return (
    <div className="sidebar-editor-container">
      <div className="sidebar-header">
        <h3>Chỉnh sửa thuộc tính</h3>
        <span className="sidebar-badge">Đã chọn: {selectedParcels.length} thửa</span>
      </div>

      <div className="sidebar-content">
        <p className="sidebar-hint">Các ô dưới đây đang trống. Bạn chỉ cần điền vào những thuộc tính muốn thay đổi. Nó sẽ được áp dụng cho toàn bộ các thửa đang chọn.</p>
        
        <div className="properties-list">
          {Object.entries(propertiesSchema).map(([key, defaultValue]) => {
            const isModified = modifiedKeys.has(key);
            return (
              <div key={key} className="property-item">
                <label className="property-label">{key}</label>
                <input 
                  type="text" 
                  placeholder={`Để trống nếu không muốn đổi`}
                  className={`property-input ${isModified ? 'modified' : ''}`}
                  style={isModified ? { borderColor: '#198754', backgroundColor: '#e8f5e9' } : {}}
                  value={editedValues[key] !== undefined && editedValues[key] !== null ? editedValues[key] : ''}
                  onChange={(e) => handleChange(key, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-footer">
        <button className="apply-btn" onClick={handleApply}>Áp dụng cho {selectedParcels.length} thửa</button>
      </div>
    </div>
  );
};

export default SidebarEditor;
