require("dotenv").config();
const http = require("http");
const { db } = require("./firebase");
const allowedOrigins = ["http://localhost:5173"];

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// Function to handle HTTP requests
const requestHandler = async (req, res) => {
    const origin = req.headers.origin;

    // Set CORS headers
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    // Handle preflight request (OPTIONS)
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    } else if (req.method === "POST" && req.url.match('/api/initialize-transaction')) {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const { email, amount, callback_url, orderId } = JSON.parse(body);

                if (!email || !amount || !callback_url || !orderId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Missing required fields' }));
                }

                // Initialize transaction with Paystack
                const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    },
                    body: JSON.stringify({
                        email,
                        amount: amount * 100,
                        callback_url,
                    }),
                });

                const paystackData = await paystackResponse.json();

                if (!paystackData.status) {
                    throw new Error('Failed to initialize transaction with Paystack');
                }

                const reference = paystackData.data.reference;

                await db.collection("orders").doc(orderId).update({reference});

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    message: 'Order initialized, awaiting payment',
                    data: paystackData.data,
                }));
            } catch (error) {
                console.error('Error initializing order:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
            }
        });
    } else if (req.method === "POST" && req.url === "/api/verify-payment") {
        let body = "";
    
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
    
        req.on("end", async () => {
            try {
                const { reference } = JSON.parse(body);
    
                if (!reference) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ error: "Missing payment reference" }));
                }
    
                // Step 1: Verify payment with Paystack
                const paystackResponse = await fetch(
                    `https://api.paystack.co/transaction/verify/${reference}`,
                    {
                        method: "GET",
                        headers: {
                            Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                            "Content-Type": "application/json",
                        },
                    }
                );
    
                const paystackData = await paystackResponse.json();
    
                if (!paystackData.status) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ error: "Payment verification failed" }));
                }
    
                const orderStatus = paystackData.data.status;
                const amountPaid = paystackData.data.amount / 100;
                const customerEmail = paystackData.data.customer.email;
    
                // Find and update the order in Firestore
                const ordersRef = db.collection("orders");
                const query = ordersRef.where("reference", "==", reference).limit(1);
                const querySnapshot = await query.get();
                
                if (querySnapshot.empty) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    return res.end(JSON.stringify({ error: "Order not found" }));
                }
    
                // Update the order's status
                const orderDoc = querySnapshot.docs[0];
                await orderDoc.ref.update({ status: orderStatus });
    
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ message: "Payment verified", status: orderStatus, amountPaid, customerEmail }));
            } catch (error) {
                console.error("Error verifying payment:", error);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error" }));
            }
        });
    }
    else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: false, message: "Route not founddddd" }));
    }
};

// Create the HTTP server
const server = http.createServer(requestHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));