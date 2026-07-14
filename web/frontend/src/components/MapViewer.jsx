import React, { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './MapViewer.css';

const FILTERED_CACHE_KEY = 'parcel-filtered-data-v1';

const EMPTY_GEO_DATA = {
  tayHieu: null,
  dongHieu: null,
  thaiHoa: null
};

const WARD_DATA_KEYS = {
  TAY_HIEU: 'tayHieu',
  DONG_HIEU: 'dongHieu',
  THAI_HOA: 'thaiHoa'
};

const WARD_LABELS = {
  tayHieu: 'TAY_HIEU',
  dongHieu: 'DONG_HIEU',
  thaiHoa: 'THAI_HOA'
};

const loadCachedFilteredData = () => {
  if (typeof window === 'undefined') {
    return EMPTY_GEO_DATA;
  }

  try {
    const raw = window.localStorage.getItem(FILTERED_CACHE_KEY);
    if (!raw) return EMPTY_GEO_DATA;

    const parsed = JSON.parse(raw);
    return {
      tayHieu: parsed.tayHieu ?? null,
      dongHieu: parsed.dongHieu ?? null,
      thaiHoa: parsed.thaiHoa ?? null
    };
  } catch {
    return EMPTY_GEO_DATA;
  }
};

const saveCachedFilteredData = (data) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FILTERED_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota / JSON issues.
  }
};

const getFeatureId = (feature) => feature?.properties?.THUAID || feature?.properties?.OBJECTID;

const collectVisibleSelections = (geoData, bounds, disablePricedParcels) => {
  const selections = [];
  const seen = new Set();

  Object.entries(geoData).forEach(([wardKey, wardData]) => {
    if (!wardData?.features) return;

    wardData.features.forEach((feature) => {
      const featureId = getFeatureId(feature);
      if (featureId == null) return;

      const selectionKey = `${wardKey}-${featureId}`;
      if (seen.has(selectionKey)) return;

      try {
        const hasPrice = Number(feature.properties?.gia_bd) > 0;
        if (disablePricedParcels && hasPrice) return;

        const featureBounds = L.geoJSON(feature).getBounds();
        if (featureBounds.isValid() && bounds.intersects(featureBounds)) {
          selections.push({ id: featureId, ward: WARD_LABELS[wardKey] });
          seen.add(selectionKey);
        }
      } catch {
        // Skip malformed geometries.
      }
    });
  });

  return selections;
};

const MapSelectionController = ({ enabled, geoData, disablePricedParcels, setSelectedParcels }) => {
  const map = useMap();
  const startPointRef = useRef(null);
  const rectangleRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const container = map.getContainer();

    if (enabled) {
      map.dragging.disable();
      map.doubleClickZoom.disable();
      container.style.cursor = 'crosshair';
    } else {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.style.cursor = '';

      if (rectangleRef.current) {
        map.removeLayer(rectangleRef.current);
        rectangleRef.current = null;
      }

      startPointRef.current = null;
      draggingRef.current = false;
    }

    return () => {
      map.dragging.enable();
      map.doubleClickZoom.enable();
      container.style.cursor = '';
    };
  }, [enabled, map]);

  useEffect(() => {
    const handleMouseDown = (e) => {
      // Bắt đầu vẽ nếu đang bật selectionMode HOẶC người dùng giữ phím Shift / Alt
      if (!enabled && !e.originalEvent.shiftKey && !e.originalEvent.altKey) return;

      if (!enabled && (e.originalEvent.shiftKey || e.originalEvent.altKey)) {
        map.dragging.disable(); // Tạm tắt kéo map khi dùng Shift/Alt+Drag
      }

      startPointRef.current = e.latlng;
      draggingRef.current = true;
      if (rectangleRef.current) {
        map.removeLayer(rectangleRef.current);
        rectangleRef.current = null;
      }
    };

    const handleMouseMove = (e) => {
      if (!draggingRef.current || !startPointRef.current) return;
      const bounds = L.latLngBounds(startPointRef.current, e.latlng);
      const color = e.originalEvent.altKey ? '#ff0000' : '#ff7800'; // Đỏ nếu là huỷ chọn (Alt)
      
      if (!rectangleRef.current) {
        rectangleRef.current = L.rectangle(bounds, { color, weight: 1 }).addTo(map);
      } else {
        rectangleRef.current.setBounds(bounds);
        rectangleRef.current.setStyle({ color }); // Cập nhật màu nếu đổi phím giữa chừng
      }
    };

    const handleMouseUp = (e) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;

      if (!enabled) {
        map.dragging.enable(); // Bật lại kéo map sau khi thả chuột
      }

      if (!startPointRef.current) return;

      const bounds = L.latLngBounds(startPointRef.current, e.latlng);

      if (rectangleRef.current) {
        map.removeLayer(rectangleRef.current);
        rectangleRef.current = null;
      }

      if (!bounds.isValid()) return;

      const selected = collectVisibleSelections(geoData, bounds, disablePricedParcels);
      
      if (e.originalEvent.altKey) {
        // Hủy chọn
        setSelectedParcels(prev => {
          const selectedIdsToRemove = new Set(selected.map(s => s.id));
          return prev.filter(p => !selectedIdsToRemove.has(p.id));
        });
      } else if (e.originalEvent.shiftKey) {
        // Cộng dồn
        setSelectedParcels(prev => {
          const newSelections = [...prev];
          selected.forEach(s => {
            if (!newSelections.find(p => p.id === s.id)) {
              newSelections.push(s);
            }
          });
          return newSelections;
        });
      } else {
        setSelectedParcels(selected);
      }
    };

    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);

    return () => {
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
    };
  }, [enabled, geoData, disablePricedParcels, map, setSelectedParcels]);

  return null;
};

const TAY_HIEU_COLOR = '#ff7800';
const DONG_HIEU_COLOR = '#4287f5';
const THAI_HOA_COLOR  = '#28b463';

const MapViewer = ({ activeWards, minPrice, maxPrice, disablePricedParcels, filterTrigger, selectedParcels, setSelectedParcels, originalData, setOriginalData, selectionMode, refreshTrigger }) => {
  const [geoData, setGeoData] = useState(() => loadCachedFilteredData());

  const centerNgheAn = [19.324, 105.419]; // Tọa độ trung tâm TX Thái Hòa
  const geojsonRefs = useRef({
    tayHieu: null,
    dongHieu: null,
    thaiHoa: null
  });

  useEffect(() => {
    const wardRequests = [];

    const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

    if (activeWards.includes('TAY_HIEU')) {
      wardRequests.push(
        fetch(`${apiBaseUrl}/api/parcels?ward=TAY_HIEU`)
          .then(res => res.json())
          .then(data => ['tayHieu', data])
      );
    }

    if (activeWards.includes('DONG_HIEU')) {
      wardRequests.push(
        fetch(`${apiBaseUrl}/api/parcels?ward=DONG_HIEU`)
          .then(res => res.json())
          .then(data => ['dongHieu', data])
      );
    }

    if (activeWards.includes('THAI_HOA')) {
      wardRequests.push(
        fetch(`${apiBaseUrl}/api/parcels?ward=THAI_HOA`)
          .then(res => res.json())
          .then(data => ['thaiHoa', data])
      );
    }

    let cancelled = false;

    if (wardRequests.length === 0) {
      setOriginalData({ tayHieu: null, dongHieu: null, thaiHoa: null });
      return undefined;
    }

    Promise.all(wardRequests)
      .then((entries) => {
        if (cancelled) return;

        setOriginalData(prev => {
          const nextData = { ...prev };
          entries.forEach(([key, data]) => {
            nextData[key] = data;
          });
          return nextData;
        });
      })
      .catch(err => console.error("Error load GeoJSON:", err));

    return () => {
      cancelled = true;
    };
  }, [activeWards, setOriginalData, refreshTrigger]);

  useEffect(() => {
    if (!originalData.tayHieu && !originalData.dongHieu && !originalData.thaiHoa) return;

    const applyFilters = (geoJsonObj) => {
      if (!geoJsonObj || !geoJsonObj.features) return geoJsonObj;
      
      const filteredFeatures = geoJsonObj.features.filter(f => {
        // 1. Luôn giữ bộ lọc đất Ở (ODT, ONT)
        const landUse = String(f.properties?.KHLOAIDAT || '').toUpperCase();
        const isResidential = landUse.includes('ODT') || landUse.includes('ONT');
        if (!isResidential) return false;

        // 2. Lọc theo gia_bd
        const giaBd = Number(f.properties?.gia_bd) || 0;
        
        if (minPrice !== '' && giaBd < Number(minPrice)) {
          return false;
        }
        if (maxPrice !== '' && giaBd > Number(maxPrice)) {
          return false;
        }

        return true;
      });

      return { ...geoJsonObj, features: filteredFeatures };
    };

    const nextGeoData = {
      tayHieu: activeWards.includes('TAY_HIEU') ? applyFilters(originalData.tayHieu) : null,
      dongHieu: activeWards.includes('DONG_HIEU') ? applyFilters(originalData.dongHieu) : null,
      thaiHoa: activeWards.includes('THAI_HOA') ? applyFilters(originalData.thaiHoa) : null
    };

    setGeoData(nextGeoData);
    saveCachedFilteredData(nextGeoData);
  }, [originalData, minPrice, maxPrice, disablePricedParcels, filterTrigger, activeWards]);

  useEffect(() => {
    const visibleIds = new Set();
    const pricedIds = new Set();

    Object.values(geoData).forEach((wardData) => {
      if (!wardData?.features) return;
      wardData.features.forEach((feature) => {
        const featureId = getFeatureId(feature);
        if (featureId != null) {
          visibleIds.add(featureId);
          if (Number(feature.properties?.gia_bd) > 0) {
            pricedIds.add(featureId);
          }
        }
      });
    });

    setSelectedParcels(prev => {
      const nextSelected = prev.filter(parcel => {
        if (!visibleIds.has(parcel.id)) return false;
        if (disablePricedParcels && pricedIds.has(parcel.id)) return false;
        return true;
      });
      if (nextSelected.length === prev.length) {
        let hasDifference = false;
        for (let index = 0; index < prev.length; index += 1) {
          if (prev[index].id !== nextSelected[index].id || prev[index].ward !== nextSelected[index].ward) {
            hasDifference = true;
            break;
          }
        }

        if (!hasDifference) {
          return prev;
        }
      }

      return nextSelected;
    });
  }, [geoData, disablePricedParcels, setSelectedParcels]);

  // Hàm Style chung hỗ trợ trạng thái selected
  const getStyle = (wardColor, feature) => {
    const id = getFeatureId(feature);
    
    // Nếu disablePricedParcels bật và thửa đã có giá -> tô xám
    const hasPrice = Number(feature.properties?.gia_bd) > 0;
    if (disablePricedParcels && hasPrice) {
      return {
        color: '#999999',
        weight: 1,
        opacity: 0.8,
        fillColor: '#999999',
        fillOpacity: 0.3
      };
    }

    const isSelected = selectedParcels.some(p => p.id === id);

    if (isSelected) {
      return {
        color: '#ff0000', // Đỏ nổi bật
        weight: 3,
        opacity: 1,
        fillColor: '#ffff00', // Vàng
        fillOpacity: 0.6
      };
    }

    return {
      color: wardColor,
      weight: 1, // Viền rất mỏng để nhìn rõ lô nhỏ
      opacity: 0.8,
      fillColor: wardColor,
      fillOpacity: 0.1 // Nền trong suốt để nhìn xuống basemap
    };
  };

  const onEachFeature = (wardKey, feature, layer) => {
    // Xây dựng nội dung Tooltip (Modal nổi) hiển thị tất cả các thuộc tính không có thanh cuộn, chia thành 3 cột
    let tooltipContent = '<div style="font-size: 9px; padding: 3px; line-height: 1.2;">';
    tooltipContent += '<h4 style="margin: 0 0 3px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; font-size: 11px;">Chi tiết thửa đất</h4>';
    tooltipContent += '<ul style="list-style: none; padding: 0; margin: 0; columns: 3; column-gap: 10px;">';
    if (feature.properties) {
      Object.entries(feature.properties).forEach(([key, value]) => {
        if (key === '_layerRef') return;
        const valStr = (value !== null && value !== undefined) ? String(value) : 'N/A';
        tooltipContent += `<li style="padding: 1px 0; border-bottom: 1px solid #eee; word-break: break-word; break-inside: avoid;"><strong>${key}:</strong> ${valStr}</li>`;
      });
    }
    tooltipContent += '</ul></div>';

    // bindTooltip với sticky: true giúp modal hiển thị liên tục khi di chuyển chuột bên trong polygon
    layer.bindTooltip(tooltipContent, {
      sticky: true,
      direction: 'auto',
      opacity: 0.95
    });

    // Sự kiện tương tác để làm nổi bật thửa đất và Click
    layer.on({
      mouseover: (e) => {
        const hasPrice = Number(feature.properties?.gia_bd) > 0;
        if (disablePricedParcels && hasPrice) return; // Vô hiệu hoá hover nếu đã có giá
        
        const lyr = e.target;
        const id = getFeatureId(feature);
        const isSelected = selectedParcels.some(p => p.id === id);
        
        if (!isSelected) {
          lyr.setStyle({
            weight: 3,
            color: '#ff0000',
            fillOpacity: 0.5
          });
          lyr.bringToFront();
        }
      },
      mouseout: (e) => {
        const hasPrice = Number(feature.properties?.gia_bd) > 0;
        if (disablePricedParcels && hasPrice) return; // Vô hiệu hoá hover nếu đã có giá

        const id = getFeatureId(feature);
        const isSelected = selectedParcels.some(p => p.id === id);
        if (!isSelected) {
          // Reset lại style nếu không được select
          if (layer.feature.properties._layerRef && layer.feature.properties._layerRef.resetStyle) {
             layer.feature.properties._layerRef.resetStyle(e.target);
          }
        }
      },
      click: (e) => {
        if (selectionMode) return;
        
        const hasPrice = Number(feature.properties?.gia_bd) > 0;
        if (disablePricedParcels && hasPrice) return; // Không cho click chọn nếu đã có giá

        const id = feature.properties?.THUAID || feature.properties?.OBJECTID;
        setSelectedParcels(prev => {
          const exists = prev.find(p => p.id === id);
          if (exists) {
            return prev.filter(p => p.id !== id);
          } else {
            return [...prev, { id, ward: wardKey }];
          }
        });
      }
    });
  };

  return (
    // preferCanvas cự kì quan trọng để tối ưu hóa render hàng nghìn Polygons
    <MapContainer 
      center={centerNgheAn} 
      zoom={14} 
      style={{ height: "100%", width: "100%" }}
      preferCanvas={true}
      boxZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapSelectionController
        enabled={selectionMode}
        geoData={geoData}
        disablePricedParcels={disablePricedParcels}
        setSelectedParcels={setSelectedParcels}
      />

      {geoData.tayHieu && (
        <GeoJSON 
          key={`tayHieu-${refreshTrigger}-${filterTrigger}-${selectedParcels.length}-${disablePricedParcels}`}
          data={geoData.tayHieu} 
          style={(feature) => getStyle(TAY_HIEU_COLOR, feature)}
          onEachFeature={(feature, layer) => onEachFeature('TAY_HIEU', feature, layer)}
          ref={(ref) => { 
            geojsonRefs.current.tayHieu = ref;
            if(ref) geoData.tayHieu.features.forEach(f => { if(!f.properties) f.properties = {}; f.properties._layerRef = ref; });
          }}
        />
      )}

      {geoData.dongHieu && (
        <GeoJSON 
          key={`dongHieu-${refreshTrigger}-${filterTrigger}-${selectedParcels.length}-${disablePricedParcels}`}
          data={geoData.dongHieu} 
          style={(feature) => getStyle(DONG_HIEU_COLOR, feature)}
          onEachFeature={(feature, layer) => onEachFeature('DONG_HIEU', feature, layer)}
          ref={(ref) => { 
            geojsonRefs.current.dongHieu = ref;
            if(ref) geoData.dongHieu.features.forEach(f => { if(!f.properties) f.properties = {}; f.properties._layerRef = ref; });
          }}
        />
      )}

      {geoData.thaiHoa && (
        <GeoJSON 
          key={`thaiHoa-${refreshTrigger}-${filterTrigger}-${selectedParcels.length}-${disablePricedParcels}`}
          data={geoData.thaiHoa} 
          style={(feature) => getStyle(THAI_HOA_COLOR, feature)}
          onEachFeature={(feature, layer) => onEachFeature('THAI_HOA', feature, layer)}
          ref={(ref) => { 
            geojsonRefs.current.thaiHoa = ref;
            if(ref) geoData.thaiHoa.features.forEach(f => { if(!f.properties) f.properties = {}; f.properties._layerRef = ref; });
          }}
        />
      )}
    </MapContainer>
  );
};

export default MapViewer;
