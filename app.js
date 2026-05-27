let baseLat = 21.02851; 
let baseLng = 105.85444;
let map, driverMarker, polyline;
let intervalId = null;
let trackPath = []; 

// 1. NGHIỆP VỤ BẢO TOÀN TRẠNG THÁI (LOCALSTORAGE)
let orderId = localStorage.getItem('current_test_order_id');
if (!orderId) {
    orderId = "DH-" + Date.now();
    localStorage.setItem('current_test_order_id', orderId);
} else {
    // Tự động kiểm tra UI khi F5 giữa đường
    // Chờ DOM tải xong trong 150ms để kích hoạt mở khóa nút tra cứu MongoDB
    setTimeout(() => {
        const btnFetchMongo = document.getElementById('btnFetchMongo');
        if (btnFetchMongo) {
            btnFetchMongo.disabled = false;
            console.log("[UI State]: Phat hien don hang chay do. Da tu dong mo khoa nut xem lich su cho don:", orderId);
        }
    }, 150);
}
console.log("Ma don hang hien tai la: ", orderId);

let driverLat = baseLat;
let driverLng = baseLng;

const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const ORDER_SERVICE_URL = 'https://orderservice-3egs.onrender.com/api/orders'; 
const TRACKING_SERVICE_URL = 'https://trackingservice-d6bf.onrender.com';

// 2. KHỔI TẠO BẢN ĐỒ VÀ KẾT NỐI SOCKET.IO
function initMap() {
    map = L.map('map').setView([baseLat, baseLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Ghim vị trí Nhà Hàng cố định
    L.marker([baseLat, baseLng]).addTo(map).bindPopup('Nha Hang').openPopup();
    
    // Khởi tạo nét vẽ lộ trình rỗng
    polyline = L.polyline([], {color: '#3182ce', weight: 4}).addTo(map);
}
initMap();

const socket = io(TRACKING_SERVICE_URL, { transports: ['websocket', 'polling'] });

socket.on('connect', () => {
    console.log("[Socket.io]: Ket noi thanh cong toi Tracking Service. ID:", socket.id);
    socket.emit('join_order_track', { orderId: orderId, role: 'customer' });
});

// Lắng nghe dòng sự kiện thời gian thực đổ về từ server tracking
socket.on('tracking_updated', (data) => {
    const logBox = document.getElementById('customerLog');
    
    const timeStr = (data.timestamp && data.timestamp.includes('T')) 
        ? data.timestamp.split('T')[1].slice(0,8) 
        : new Date().toLocaleTimeString();
    
    logBox.innerHTML += `[${timeStr}] Nhan Event tu Server: [${data.status}]<br>`;
    logBox.scrollTop = logBox.scrollHeight;

    // Xử lý dịch chuyển xe máy và vẽ đường khi tài xế đi ship
    if (data.status === "Đang giao hàng") {
        const currentPos = [data.latitude, data.longitude];
        
        if (!driverMarker) {
            driverMarker = L.marker(currentPos, {
                icon: L.icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                    iconSize: [25, 41], iconAnchor: [12, 41]
                })
            }).addTo(map).bindPopup('Tai xe dang di chuyen').openPopup();
        } else {
            driverMarker.setLatLng(currentPos);
        }

        trackPath.push(currentPos);
        polyline.setLatLngs(trackPath);
        map.panTo(currentPos);
    }

    // Xử lý khi nhận trạng thái kết thúc hành trình
    if (data.status === "Đã hoàn thành" && driverMarker) {
        driverMarker.bindPopup('Da giao hang thanh cong!').openPopup();
    }
});

// 3. LUỒNG NGHIỆP VỤ ĐIỀU KHIỂN HỆ THỐNG

// BƯỚC 1: ĐẶT ĐƠN
function placeOrder() {
    const customerName = document.getElementById('inputCustomerName').value;
    const foodSelect = document.getElementById('selectItem');
    const drinkSelect = document.getElementById('selectDrink');

    const foodName = foodSelect.value;
    const drinkName = drinkSelect.value;
    
    const foodPrice = parseInt(foodSelect.options[foodSelect.selectedIndex].getAttribute('data-price'));
    const drinkPrice = parseInt(drinkSelect.options[drinkSelect.selectedIndex].getAttribute('data-price'));
    const totalPrice = foodPrice + drinkPrice;

    document.getElementById('btnPlaceOrder').disabled = true;
    document.getElementById('driverLog').innerHTML = "Dang gui don hang toi Order Service...";

    fetch(ORDER_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderId: orderId,
            customerName: customerName,
            items: [foodName, drinkName].filter(item => item !== "Không uống nước"),
            totalPrice: totalPrice
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success || data.orderId) {
            document.getElementById('step-order').style.display = 'none';
            document.getElementById('step-process').style.display = 'block';
            
            document.getElementById('driverLog').innerHTML = `<span style='color: #dd6b20;'>He thong: Mon an (${foodName}) dang duoc chuan bi</span>`;
            console.log("[Order Service Response]:", data.message);
        } else {
            alert("Order Service tu choi xu ly: " + data.error);
            document.getElementById('btnPlaceOrder').disabled = false;
        }
    })
    .catch(err => {
        console.error("Loi ket noi lien dich vu:", err);
        alert("Khong the ket noi toi Order Service. Vui long kiem tra lai moi truong.");
        document.getElementById('btnPlaceOrder').disabled = false;
    });
}

// BƯỚC 2: TÀI XẾ NHẬN ĐƠN & KHỞI HÀNH GIAO HÀNG
function startDelivery() {
    document.getElementById('step-process').style.display = 'none';
    document.getElementById('step-shipping').style.display = 'block';
    document.getElementById('driverLog').innerHTML = "<span style='color: #3182ce;'>Tai xe dang giao hang tren duong</span>";

    driverLat = baseLat;
    driverLng = baseLng;

    intervalId = setInterval(() => {
        driverLat -= 0.00025; 
        driverLng += 0.00035;

        socket.emit('update_location', {
            orderId: orderId,
            latitude: driverLat,
            longitude: driverLng,
            status: "Đang giao hàng"
        });
    }, 3000); 
}

// BƯỚC 3: TÀI XẾ BẤM HOÀN THÀNH KHI ĐẾN ĐÍCH
function completeOrder() {
    if (intervalId) { 
        clearInterval(intervalId); 
        intervalId = null; 
    }
    
    const completeBtn = document.getElementById('btnCompleteOrder') || document.getElementById('completeOrder');
    if (completeBtn) completeBtn.disabled = true;

    document.getElementById('btnFetchMongo').disabled = false; 
    document.getElementById('driverLog').innerHTML = "<span style='color: #2f855a;'>Don hang da giao thanh cong!</span>";

    socket.emit('update_location', { 
        orderId: orderId, 
        latitude: driverLat, 
        longitude: driverLng, 
        status: "Đã hoàn thành" 
    });

    localStorage.removeItem('current_test_order_id');
}

// BƯỚC TRA CỨU: TRÍCH XUẤT TOÀN BỘ LỊCH SỬ TỪ CLOUD
function fetchMongoData() {
    fetch(`${TRACKING_SERVICE_URL}/api/tracking/history/${orderId}`)
        .then(res => res.json())
        .then(data => {
            alert(`Du lieu Trich xuat Co so du lieu truc tuyen\n\n` +
                  `• Ma don hang: ${data.orderId}\n` +
                  `• Trang thai cuoi (RAM Upstash Redis): ${data.redisLatestLocation ? data.redisLatestLocation.status : "N/A"}\n` +
                  `• Tong so diem dinh vi (MongoDB Atlas): ${data.mongoTotalPointsSaved} diem toa do.`);
            console.log("Chi tiet mang vet lo trinh luu tai MongoDB Atlas:", data.mongoRouteHistory);
        })
        .catch(err => alert("Loi khi ket noi API co so du lieu lich su."));
}