import React from 'react';
import './Navbar.css';

const Navbar = ({ activeWards, setActiveWards, minPrice, setMinPrice, maxPrice, setMaxPrice, onApplyFilter, selectionMode, setSelectionMode }) => {
  const handleWardChange = (e) => {
    const { value, checked } = e.target;
    if (checked) {
      setActiveWards([...activeWards, value]);
    } else {
      setActiveWards(activeWards.filter(w => w !== value));
    }
  };

  return (
    <div className="navbar-container">
      <div className="navbar-section">
        <span className="navbar-title">Phường/Xã:</span>
        <label className="navbar-checkbox">
          <input type="checkbox" value="TAY_HIEU" checked={activeWards.includes('TAY_HIEU')} onChange={handleWardChange} /> Tây Hiếu
        </label>
        <label className="navbar-checkbox">
          <input type="checkbox" value="DONG_HIEU" checked={activeWards.includes('DONG_HIEU')} onChange={handleWardChange} /> Đông Hiếu
        </label>
        <label className="navbar-checkbox">
          <input type="checkbox" value="THAI_HOA" checked={activeWards.includes('THAI_HOA')} onChange={handleWardChange} /> Thái Hòa
        </label>
      </div>

      <div className="navbar-divider"></div>

      <div className="navbar-section">
        <span className="navbar-title">Giá BĐS (gia_bd):</span>
        <input 
          type="number" 
          placeholder="Từ..." 
          value={minPrice} 
          onChange={(e) => setMinPrice(e.target.value)} 
          className="navbar-input"
        />
        <span> - </span>
        <input 
          type="number" 
          placeholder="Đến..." 
          value={maxPrice} 
          onChange={(e) => setMaxPrice(e.target.value)} 
          className="navbar-input"
        />
      </div>

      <div className="navbar-section" style={{ marginLeft: 'auto' }}>
        <button
          className={`navbar-btn navbar-btn-secondary ${selectionMode ? 'active' : ''}`}
          onClick={() => setSelectionMode(prev => !prev)}
        >
          {selectionMode ? 'Thoát chọn vùng' : 'Chọn vùng'}
        </button>
        <button className="navbar-btn" onClick={onApplyFilter}>Áp dụng lọc</button>
      </div>
    </div>
  );
};

export default Navbar;
