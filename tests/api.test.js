/* =====================================================
   TEMPLE DONATION TRACKER - API TESTS
   Tests using actual MongoDB Atlas connection
   ===================================================== */

const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

let app;
let Category, Donation, SubAdmin, Settings;
let testCategoryId;

beforeAll(async () => {
    // Connect to MongoDB Atlas
    console.log('🔗 Connecting to MongoDB Atlas...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB Atlas');

    // Get models
    const categorySchema = new mongoose.Schema({
        name: { type: String, required: true },
        order: { type: Number, default: 0 },
        createdAt: { type: Date, default: Date.now }
    });

    const donationSchema = new mongoose.Schema({
        donorName: { type: String, required: true },
        amount: { type: Number, required: true },
        date: { type: Date, required: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        notes: { type: String, default: '' }
    });

    const subAdminSchema = new mongoose.Schema({
        username: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        permissions: {
            canAddDonation: { type: Boolean, default: true },
            canEditDonation: { type: Boolean, default: false },
            canDeleteDonation: { type: Boolean, default: false },
            canManageCategory: { type: Boolean, default: false },
            assignedCategories: [{ type: mongoose.Schema.Types.ObjectId }]
        }
    });

    const settingsSchema = new mongoose.Schema({
        adminPassword: { type: String, required: true },
        viewMode: { type: String, default: 'cards' }
    });

    // Use existing models or create new ones
    Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
    Donation = mongoose.models.Donation || mongoose.model('Donation', donationSchema);
    SubAdmin = mongoose.models.SubAdmin || mongoose.model('SubAdmin', subAdminSchema);
    Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

    // Setup Express app
    app = express();
    app.use(cors());
    app.use(express.json());

    // Auth route
    app.post('/api/auth/login', async (req, res) => {
        const { username, password } = req.body;
        if (username === 'admin') {
            const settings = await Settings.findOne();
            if (settings && await bcrypt.compare(password, settings.adminPassword)) {
                return res.json({ success: true, user: { type: 'admin' } });
            }
        }
        res.status(401).json({ success: false });
    });

    // Categories routes
    app.get('/api/categories', async (req, res) => {
        const cats = await Category.find().sort({ order: 1 });
        res.json(cats);
    });

    app.post('/api/categories', async (req, res) => {
        const cat = await Category.create({ ...req.body, order: Date.now() });
        res.status(201).json(cat);
    });

    app.delete('/api/categories/:id', async (req, res) => {
        await Category.findByIdAndDelete(req.params.id);
        res.json({ message: 'deleted' });
    });

    // Donations routes
    app.get('/api/donations', async (req, res) => {
        const donations = await Donation.find().populate('categoryId');
        res.json(donations);
    });

    app.post('/api/donations', async (req, res) => {
        const donation = await Donation.create(req.body);
        res.status(201).json(donation);
    });

    app.delete('/api/donations/:id', async (req, res) => {
        await Donation.findByIdAndDelete(req.params.id);
        res.json({ message: 'deleted' });
    });

    // Stats route
    app.get('/api/stats', async (req, res) => {
        const totalDonors = await Donation.countDocuments();
        const result = await Donation.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
        const totalCategories = await Category.countDocuments();
        res.json({ totalDonors, totalAmount: result[0]?.total || 0, totalCategories });
    });
});

afterAll(async () => {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
});

// ==================== TESTS ====================

describe('🔐 Auth API', () => {
    test('admin login with correct password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'admin123' });
        expect(res.body.success).toBe(true);
    });

    test('reject wrong password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'wrong' });
        expect(res.statusCode).toBe(401);
    });
});

describe('📁 Categories API', () => {
    test('create category', async () => {
        const res = await request(app)
            .post('/api/categories')
            .send({ name: 'TEST_CATEGORY_' + Date.now() });
        expect(res.statusCode).toBe(201);
        testCategoryId = res.body._id;
    });

    test('get categories', async () => {
        const res = await request(app).get('/api/categories');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('delete test category', async () => {
        if (testCategoryId) {
            const res = await request(app).delete(`/api/categories/${testCategoryId}`);
            expect(res.statusCode).toBe(200);
        }
    });
});

describe('💰 Donations API', () => {
    let tempCatId, tempDonationId;

    beforeAll(async () => {
        const cat = await Category.create({ name: 'TEMP_FOR_DONATION_TEST', order: 999 });
        tempCatId = cat._id;
    });

    afterAll(async () => {
        if (tempDonationId) await Donation.findByIdAndDelete(tempDonationId);
        if (tempCatId) await Category.findByIdAndDelete(tempCatId);
    });

    test('create donation', async () => {
        const res = await request(app)
            .post('/api/donations')
            .send({
                donorName: 'Test Donor',
                amount: 1000,
                date: new Date(),
                categoryId: tempCatId
            });
        expect(res.statusCode).toBe(201);
        tempDonationId = res.body._id;
    });

    test('get donations', async () => {
        const res = await request(app).get('/api/donations');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

describe('📊 Stats API', () => {
    test('get stats', async () => {
        const res = await request(app).get('/api/stats');
        expect(res.statusCode).toBe(200);
        expect(typeof res.body.totalDonors).toBe('number');
        expect(typeof res.body.totalAmount).toBe('number');
        expect(typeof res.body.totalCategories).toBe('number');
    });
});

describe('🔒 Hindi Support', () => {
    let hindiCatId, hindiDonationId;

    afterAll(async () => {
        if (hindiDonationId) await Donation.findByIdAndDelete(hindiDonationId);
        if (hindiCatId) await Category.findByIdAndDelete(hindiCatId);
    });

    test('create Hindi category', async () => {
        const res = await request(app)
            .post('/api/categories')
            .send({ name: 'टेस्ट टोला' });
        expect(res.statusCode).toBe(201);
        expect(res.body.name).toBe('टेस्ट टोला');
        hindiCatId = res.body._id;
    });

    test('create Hindi donation', async () => {
        const res = await request(app)
            .post('/api/donations')
            .send({
                donorName: 'श्री राम जी',
                amount: 51000,
                date: new Date(),
                categoryId: hindiCatId,
                notes: 'मंदिर निर्माण'
            });
        expect(res.statusCode).toBe(201);
        expect(res.body.donorName).toBe('श्री राम जी');
        hindiDonationId = res.body._id;
    });
});

console.log(`
╔═══════════════════════════════════════════════════════╗
║  🛕 Temple Donation Tracker - MongoDB Atlas Tests     ║
╚═══════════════════════════════════════════════════════╝
`);
