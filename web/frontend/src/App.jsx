import React, { useEffect, useState } from 'react';
import MapViewer from './components/MapViewer';
import Navbar from './components/Navbar';
import SidebarEditor from './components/SidebarEditor';
import './App.css';

const FILTER_CACHE_KEY = 'parcel-filter-state-v1';

const DEFAULT_FILTER_STATE = {
  activeWards: ['TAY_HIEU', 'DONG_HIEU', 'THAI_HOA'],
  minPrice: '',
  maxPrice: '',
  disablePricedParcels: false
};

const loadCachedFilterState = () => {
  if (typeof window === 'undefined') {
    return DEFAULT_FILTER_STATE;
  }

  try {
    const raw = window.localStorage.getItem(FILTER_CACHE_KEY);
    if (!raw) return DEFAULT_FILTER_STATE;

    const parsed = JSON.parse(raw);
    return {
      activeWards: Array.isArray(parsed.activeWards) && parsed.activeWards.length > 0
        ? parsed.activeWards
        : DEFAULT_FILTER_STATE.activeWards,
      minPrice: parsed.minPrice ?? '',
      maxPrice: parsed.maxPrice ?? '',
      disablePricedParcels: parsed.disablePricedParcels ?? false
    };
  } catch {
    return DEFAULT_FILTER_STATE;
  }
};

function App() {
  const cachedFilterState = loadCachedFilterState();

  const [activeWards, setActiveWards] = useState(cachedFilterState.activeWards);
  const [minPrice, setMinPrice] = useState(cachedFilterState.minPrice);
  const [maxPrice, setMaxPrice] = useState(cachedFilterState.maxPrice);
  const [disablePricedParcels, setDisablePricedParcels] = useState(cachedFilterState.disablePricedParcels);
  
  // State trigger để chỉ áp dụng bộ lọc khi bấm nút
  const [filterTrigger, setFilterTrigger] = useState(0);

  const [selectionMode, setSelectionMode] = useState(false);

  // Danh sách các thửa được chọn
  const [selectedParcels, setSelectedParcels] = useState([]);

  // Dữ liệu gốc để lấy thuộc tính
  const [originalData, setOriginalData] = useState({
    tayHieu: null,
    dongHieu: null,
    thaiHoa: null
  });

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleApplyFilter = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FILTER_CACHE_KEY, JSON.stringify({
        activeWards,
        minPrice,
        maxPrice,
        disablePricedParcels
      }));
    }

    setFilterTrigger(prev => prev + 1);
  };

  const handleApplyEdits = async (updates) => {
    if (selectedParcels.length === 0) return;

    const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    const payload = {
      updates: {
        'TAY_HIEU': { ids: [], properties: updates },
        'DONG_HIEU': { ids: [], properties: updates },
        'THAI_HOA': { ids: [], properties: updates }
      }
    };

    selectedParcels.forEach(p => {
      payload.updates[p.ward].ids.push(p.id);
    });

    try {
      const response = await fetch(`${apiBaseUrl}/api/update-parcels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) {
        setSelectedParcels([]);
        setRefreshTrigger(prev => prev + 1);
        alert(`Đã cập nhật thành công ${data.totalUpdated} thửa đất!`);
      } else {
        alert('Cập nhật thất bại: ' + (data.error || 'Unknown'));
      }
    } catch (err) {
      alert('Lỗi khi gọi API: ' + err.message);
    }
  };

  return (
    <div className="app-container">
      <Navbar 
        activeWards={activeWards} setActiveWards={setActiveWards}
        minPrice={minPrice} setMinPrice={setMinPrice}
        maxPrice={maxPrice} setMaxPrice={setMaxPrice}
        disablePricedParcels={disablePricedParcels} setDisablePricedParcels={setDisablePricedParcels}
        onApplyFilter={handleApplyFilter}
        selectionMode={selectionMode}
        setSelectionMode={setSelectionMode}
      />
      <div className="main-content">
        <div className="map-section">
          <MapViewer 
            activeWards={activeWards} 
            minPrice={minPrice} 
            maxPrice={maxPrice} 
            disablePricedParcels={disablePricedParcels}
            filterTrigger={filterTrigger}
            selectedParcels={selectedParcels}
            setSelectedParcels={setSelectedParcels}
            originalData={originalData}
            setOriginalData={setOriginalData}
            selectionMode={selectionMode}
            refreshTrigger={refreshTrigger}
          />
        </div>
        {selectedParcels.length > 0 && (
          <div className="sidebar-section">
            <SidebarEditor 
              selectedParcels={selectedParcels}
              originalData={originalData}
              onApplyEdits={handleApplyEdits}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
