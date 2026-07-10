import React, { useEffect, useState } from 'react';
import MapViewer from './components/MapViewer';
import Navbar from './components/Navbar';
import SidebarEditor from './components/SidebarEditor';
import './App.css';

const FILTER_CACHE_KEY = 'parcel-filter-state-v1';

const DEFAULT_FILTER_STATE = {
  activeWards: ['TAY_HIEU', 'DONG_HIEU', 'THAI_HOA'],
  minPrice: '',
  maxPrice: ''
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
      maxPrice: parsed.maxPrice ?? ''
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

  const handleApplyFilter = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FILTER_CACHE_KEY, JSON.stringify({
        activeWards,
        minPrice,
        maxPrice
      }));
    }

    setFilterTrigger(prev => prev + 1);
  };

  const handleApplyEdits = async (updates) => {
    if (selectedParcels.length === 0) return;

    const parcelsToUpdate = selectedParcels;

    const apiBaseUrl = import.meta.env.DEV ? 'http://localhost:3001' : '';

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
        const wardStateKey = {
          TAY_HIEU: 'tayHieu',
          DONG_HIEU: 'dongHieu',
          THAI_HOA: 'thaiHoa'
        };

        setOriginalData(prev => {
          const nextData = { ...prev };

          parcelsToUpdate.forEach(parcel => {
            const stateKey = wardStateKey[parcel.ward];
            const wardData = prev[stateKey];
            if (!wardData?.features) return;

            nextData[stateKey] = {
              ...wardData,
              features: wardData.features.map(feature => {
                const featureId = feature?.properties?.THUAID || feature?.properties?.OBJECTID;
                if (featureId !== parcel.id) return feature;

                return {
                  ...feature,
                  properties: {
                    ...feature.properties,
                    ...updates
                  }
                };
              })
            };
          });

          return nextData;
        });

        setSelectedParcels([]);
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
            filterTrigger={filterTrigger}
            selectedParcels={selectedParcels}
            setSelectedParcels={setSelectedParcels}
            originalData={originalData}
            setOriginalData={setOriginalData}
            selectionMode={selectionMode}
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
