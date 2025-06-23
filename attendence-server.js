const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

const corsOptions = {
    origin: ['https://spectra.anuragnarsingoju.tech'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
};

app.use(cors(corsOptions));
app.use(express.json());

const validateOrigin = (req, res, next) => {
    const allowedOrigins = ['https://spectra.anuragnarsingoju.tech'];
    const requestOrigin = req.headers.origin;

    if (!allowedOrigins.includes(requestOrigin)) {
        return res.status(403).json({ error: 'Unauthorized request' });
    }
    next();
};

app.use(validateOrigin);


const CREDENTIALS_MAP = {
    '054205': { mobilenumber: '7660066656', password: 'Anurag9090' },
    '172835': { mobilenumber: '9381150341', password: 'Aashish12345' },
    '231566': { mobilenumber: '6303895820', password: 'aA12345$' },
    '190404': { mobilenumber: '9515360456', password: 'Pokemon@123' },
};


app.post('/attendance', async (req, res) => {
    const { pin } = req.body;

    if (!CREDENTIALS_MAP[pin]) {
        return res.status(400).json({ success: false, message: 'Invalid PIN' });
    }

    const credentials = CREDENTIALS_MAP[pin];

    try {
        const loginRes = await fetch('http://apps.teleuniv.in/api/auth/netralogin.php?college=KMIT', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Origin': 'http://kmit-netra.teleuniv.in' },
            body: JSON.stringify({
                mobilenumber: credentials.mobilenumber,
                password: credentials.password
            })
            
        });

        console.log(loginRes);

        const loginData = await loginRes.json();
        if (!loginData.token) {
            return res.status(401).json({ success: false, message: 'Login failed' });
        }

        const attRes = await fetch('https://spectraserver-indol.vercel.app/api/attendance', {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Authorization': `Bearer ${loginData.token}`,
                'Content-Type': 'application/json',
                'Origin': 'https://spectra-beta.vercel.app',
                'Referer': 'https://spectra-beta.vercel.app/'
            },
            body: JSON.stringify({ method: "314" })
        });

        const attData = await attRes.json();
        res.json(attData);

    } catch (error) {
        console.error('Attendance Fetch Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});


app.post('/profile', async (req, res) => {
    const { pin } = req.body;

    if (!CREDENTIALS_MAP[pin]) {
        return res.status(400).json({ success: false, message: 'Invalid PIN' });
    }

    const credentials = CREDENTIALS_MAP[pin];

    try {
        const loginRes = await fetch('http://apps.teleuniv.in/api/auth/netralogin.php?college=KMIT', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Origin': 'http://kmit-netra.teleuniv.in' },
            body: JSON.stringify({
                mobilenumber: credentials.mobilenumber,
                password: credentials.password
            })
        });

        const loginData = await loginRes.json();
        if (!loginData.token) {
            return res.status(401).json({ success: false, message: 'Login failed' });
        }

        const profileRes = await fetch('https://spectraserver-indol.vercel.app/api/profile', {
            method: 'POST',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Authorization': `Bearer ${loginData.token}`,
                'Content-Type': 'application/json',
                'Origin': 'https://spectra-beta.vercel.app',
                'Referer': 'https://spectra-beta.vercel.app/'
            },
            body: JSON.stringify({ method: "32" })
        });

        const profileData = await profileRes.json();
        res.json(profileData);

    } catch (error) {
        console.error('Profile Fetch Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});


app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});