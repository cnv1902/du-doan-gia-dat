import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
import warnings

# Bỏ qua các cảnh báo toán học không quan trọng để màn hình console sạch sẽ
warnings.filterwarnings("ignore", category=RuntimeWarning)

file_path = 'DuLieu_GiaDat.xlsx'

try:
    # =====================================================================
    # 1. ĐỌC VÀ CHUẨN BỊ DỮ LIỆU
    # =====================================================================
    df = pd.read_excel(file_path, sheet_name='ODT')
    
    print("Dữ liệu đã đọc thành công từ sheet ODT!")
    print(f"Kích thước ban đầu: {df.shape}")

    # Tính biến mục tiêu (Logarit của Giá)
    df['ln_GIA'] = np.log(df['GIA_BD'])

    # =====================================================================
    # 2. TIỀN XỬ LÝ (LOẠI BỎ BIẾN VĨ MÔ/MÔI TRƯỜNG & TẠO BIẾN GIẢ)
    # =====================================================================
    # Xóa các biến vĩ mô, môi trường, quy hoạch (do phương sai = 0 hoặc đồng nhất không gian)
    cols_to_drop = [col for col in df.columns if col.startswith(('YT_', 'MT_', 'QH_'))]
    if cols_to_drop:
        df.drop(columns=cols_to_drop, inplace=True)
        print(f"\n=> Đã loại bỏ {len(cols_to_drop)} biến vĩ mô/môi trường/quy hoạch.")

    # Chuyển đổi mã Xã (XAID) thành biến phân loại (Dummy). 
    # Đông Hiếu tự động thành Base Case do drop_first=True
    df = pd.get_dummies(df, columns=['XAID'], drop_first=True)
    
    # Chuyển các cột True/False sinh ra từ get_dummies thành float (1.0 / 0.0)
    for col in df.columns:
        if df[col].dtype == bool:
            df[col] = df[col].astype(float)

    # =====================================================================
    # 3. TÁCH DỮ LIỆU (TRAIN / TEST)
    # =====================================================================
    y = df['ln_GIA']
    X = df.drop(columns=['GIA_BD', 'ln_GIA'])
    X = X.astype(float)
    X = sm.add_constant(X)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, 
        test_size=0.20, 
        random_state=42,
        stratify=df['GIA_BD']
    )

    print(f"\nKích thước tập Huấn luyện (Train): {X_train.shape[0]} mẫu")
    print(f"Kích thước tập Kiểm tra (Test): {X_test.shape[0]} mẫu")

    # =====================================================================
    # 4. AUTOMATED FEATURE SELECTION (LỌC BIẾN TỰ ĐỘNG)
    # =====================================================================
    features = list(X_train.columns)
    
    # KHIÊN BẢO VỆ: Lấy danh sách đích danh các biến Xã (Bắt đầu bằng XAID_)
    protected_vars = [col for col in features if col.startswith('XAID_')]
    print(f"\n[*] ĐÃ BẬT KHIÊN BẢO VỆ ĐƠN VỊ HÀNH CHÍNH (Fixed Effects): {protected_vars}")

    # Tính độ tương quan Pearson với biến Y để làm cơ sở ra quyết định ở Vòng 1
    y_correlations = X_train.corrwith(y_train).abs()

    print("\n" + "="*60)
    print("VÒNG 1: XỬ LÝ ĐA CỘNG TUYẾN (CLASSIC MAX-VIF KẾT HỢP BẢO VỆ XAID)")
    print("="*60)
    
    while True:
        vif_data = pd.DataFrame()
        vif_data["feature"] = features
        vif_data["VIF"] = [variance_inflation_factor(X_train[features].values, i) for i in range(len(features))]
        
        # Chỉ xét loại bỏ các biến KHÔNG phải là hằng số và KHÔNG phải biến Xã
        vif_candidates = vif_data[
            (vif_data['feature'] != 'const') & 
            (~vif_data['feature'].isin(protected_vars))
        ]
        
        if vif_candidates.empty:
            break
            
        # Tìm biến có VIF cao nhất trong nhóm được phép loại (Phương pháp gốc)
        max_vif_row = vif_candidates.sort_values('VIF', ascending=False).iloc[0]
        max_vif = max_vif_row['VIF']
        remove_var = max_vif_row['feature']
        
        if max_vif > 10:
            features.remove(remove_var)
            print(f"[-] Đã loại: {remove_var:<15} (VIF = {max_vif:.2f})")
        else:
            print("=> Hoàn tất Vòng 1: Các biến định lượng còn lại đều có VIF <= 10.")
            break
        
    print("\n" + "="*60)
    print("VÒNG 2: LOẠI TRỪ NGƯỢC THEO Ý NGHĨA THỐNG KÊ (P-VALUE > 0.05)")
    print("="*60)
    
    while True:
        model = sm.OLS(y_train, X_train[features]).fit()
        
        # Lấy P-value của các biến, bảo vệ biến chặn và biến Xã
        pvalues = model.pvalues.drop(['const'] + protected_vars, errors='ignore')
        
        if pvalues.empty:
            break
            
        max_pvalue = pvalues.max()
        remove_var = pvalues.idxmax()
        
        if max_pvalue > 0.05:
            features.remove(remove_var)
            print(f"[-] Đã loại: {remove_var:<15} (P-value = {max_pvalue:.4f})")
        else:
            print("=> Hoàn tất Vòng 2: Tất cả các biến liên tục còn lại đều có P-value <= 0.05.")
            break

    # =====================================================================
    # 5. KẾT QUẢ VÀ ĐÁNH GIÁ MÔ HÌNH
    # =====================================================================
    final_model = sm.OLS(y_train, X_train[features]).fit()
    
    print("\n" + "="*60)
    print("BẢNG KẾT QUẢ MÔ HÌNH HỒI QUY CUỐI CÙNG (DÙNG CHO BÁO CÁO)")
    print("="*60)
    print(final_model.summary())

    from sklearn.metrics import mean_absolute_error, mean_squared_error
    y_pred_log = final_model.predict(X_test[features])
    y_pred_real = np.exp(y_pred_log)
    y_test_real = np.exp(y_test)

    mae = mean_absolute_error(y_test_real, y_pred_real)
    rmse = np.sqrt(mean_squared_error(y_test_real, y_pred_real))

    print("\n" + "="*60)
    print("ĐÁNH GIÁ ĐỘ CHÍNH XÁC CỦA MÔ HÌNH TRÊN TẬP TEST (20%)")
    print("="*60)
    print(f"Sai số tuyệt đối trung bình (MAE) : {mae:.4f}")
    print(f"Sai số bình phương trung bình (RMSE): {rmse:.4f}")

    # =====================================================================
    # 6. TRÍCH XUẤT CÔNG THỨC CHO QGIS
    # =====================================================================
    print("\n" + "="*60)
    print("CÔNG THỨC NỘI SUY DÙNG CHO QGIS FIELD CALCULATOR")
    print("="*60)

    terms = []
    for feature, coef in final_model.params.items():
        coef_rounded = round(coef, 6)
        
        if feature == 'const':
            terms.append(f"{coef_rounded}")
        elif feature.startswith("XAID_"):
            xa_val = feature.replace("XAID_", "")
            terms.append(f"({coef_rounded} * (CASE WHEN \"XAID\" = '{xa_val}' THEN 1 ELSE 0 END))")
        else:
            terms.append(f"({coef_rounded} * \"{feature}\")")

    qgis_formula = "exp(\n  " + " +\n  ".join(terms) + "\n)"
    print(qgis_formula)
    print("="*60)
    
except Exception as e:
    print(f"Đã xảy ra lỗi: {e}")