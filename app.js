let baseLat = 21.02851; 
let baseLng = 105.85444;
let map, driverMarker, polyline;
let intervalId = null;
let trackPath = []; 
const orderId = "DH-" + Date.now();
console.log("🆔 Mã đơn hàng test cho phiên làm việc này là:", orderId);

let driverLat = baseLat;
let driverLng = baseLng;


function initMap() {
    map = L.map('map').setView([baseLat, baseLng], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    L.marker([baseLat, baseLng]).addTo(map).bindPopup('Nhà Hàng').openPopup();
    
    polyline = L.polyline([], {color: '#3182ce', weight: 4}).addTo(map);
}
initMap();

const socket = io('http://localhost:5001', {
    transports: ['websocket', 'polling']
});

socket.on('connect', () => {
    console.log("[Socket.io]: Kết nối thành công tới Tracking Service. ID:", socket.id);
    socket.emit('join_order_track', { orderId: orderId, role: 'customer' });
});

socket.on('tracking_updated', (data) => {
    const logBox = document.getElementById('customerLog');
    
    const timeStr = (data.timestamp && data.timestamp.includes('T')) 
        ? data.timestamp.split('T')[1].slice(0,8) 
        : new Date().toLocaleTimeString();
    
    logBox.innerHTML += `[${timeStr}] Nhận Event từ Server: [${data.status}]<br>`;
    logBox.scrollTop = logBox.scrollHeight;

    if (data.status === "Đang giao hàng") {
        const currentPos = [data.latitude, data.longitude];
        
        if (!driverMarker) {
            driverMarker = L.marker(currentPos, {
                icon: L.icon({
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
                    iconSize: [25, 41], iconAnchor: [12, 41]
                })
            }).addTo(map).bindPopup('🛵 Tài xế đang di chuyển').openPopup();
        } else {
            driverMarker.setLatLng(currentPos);
        }

        trackPath.push(currentPos);
        polyline.setLatLngs(trackPath);
        map.panTo(currentPos);
    }

    if (data.status === "Đã hoàn thành" && driverMarker) {
        driverMarker.bindPopup('🎉 Đã giao hàng thành công!').openPopup();
    }
});

function placeOrder() {
    // 1. Lấy dữ liệu động từ giao diện Form nhập vào
    const customerName = document.getElementById('inputCustomerName').value;
    const foodSelect = document.getElementById('selectItem');
    const drinkSelect = document.getElementById('selectDrink');

    const foodName = foodSelect.value;
    const drinkName = drinkSelect.value;
    
    // Tính tổng tiền động dựa trên thuộc tính data-price của option được chọn
    const foodPrice = parseInt(foodSelect.options[foodSelect.selectedIndex].getAttribute('data-price'));
    const drinkPrice = parseInt(drinkSelect.options[drinkSelect.selectedIndex].getAttribute('data-price'));
    const totalPrice = foodPrice + drinkPrice;

    document.getElementById('btnPlaceOrder').disabled = true;
    document.getElementById('driverLog').innerHTML = " Đang gửi đơn hàng tới Order Service...";

    const ORDER_SERVICE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api/orders'
    : 'https://orderservice-3egs.onrender.com';

    fetch(ORDER_SERVICE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderId: orderId, // Vẫn dùng DH-2026 cố định cho bài test websocket phòng (room)
            customerName: customerName,
            items: [foodName, drinkName].filter(item => item !== "Không uống nước"), // Lọc bỏ nếu ko chọn nước
            totalPrice: totalPrice
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success || data.orderId) {
            document.getElementById('step-order').style.display = 'none';
            document.getElementById('step-process').style.display = 'block';
            
            document.getElementById('driverLog').innerHTML = `<span style='color: #dd6b20;'>Hệ thống: Món ăn (${foodName}) đang được chuẩn bị</span>`;
            console.log("📦 [Order Service Response]:", data.message);
        } else {
            alert("Order Service từ chối xử lý: " + data.error);
            document.getElementById('btnPlaceOrder').disabled = false;
        }
    })
    .catch(err => {
        console.error("Lỗi kết nối liên dịch vụ:", err);
        alert("Không thể kết nối tới Order Service.");
        document.getElementById('btnPlaceOrder').disabled = false;
    });
}

function startDelivery() {
    document.getElementById('step-process').style.display = 'none';
    document.getElementById('step-shipping').style.display = 'block';
    document.getElementById('driverLog').innerHTML = "<span style='color: #3182ce;'>Tài xế đang giao hàng trên đường</span>";

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

function completeOrder() {
    if (intervalId) { 
        clearInterval(intervalId); 
        intervalId = null; 
    }
    document.getElementById('btnCompleteOrder').disabled = true;
    document.getElementById('btnFetchMongo').disabled = false; 
    document.getElementById('driverLog').innerHTML = "<span style='color: #2f855a;'>Đơn hàng đã giao thành công!</span>";

    socket.emit('update_location', { 
        orderId: orderId, 
        latitude: driverLat, 
        longitude: driverLng, 
        status: "Đã hoàn thành" 
    });
}

function fetchMongoData() {
    fetch(`http://localhost:5001/api/tracking/history/${orderId}`)
        .then(res => res.json())
        .then(data => {
            alert(`Dữ liệu Trích xuất Cơ sở dữ liệu trực tuyến\n\n` +
                  `• Mã đơn hàng: ${data.orderId}\n` +
                  `• Trạng thái cuối (RAM Upstash Redis): ${data.redisLatestLocation ? data.redisLatestLocation.status : "N/A"}\n` +
                  `• Tổng số điểm định vị (MongoDB Atlas): ${data.mongoTotalPointsSaved} điểm tọa độ.`);
            console.log("Chi tiết mảng vệt lộ trình lưu tại MongoDB Atlas:", data.mongoRouteHistory);
        })
        .catch(err => alert("Lỗi khi kết nối API cơ sở dữ liệu lịch sử."));
}