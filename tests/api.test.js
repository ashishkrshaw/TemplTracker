/* =====================================================
   TEMPLE DONATION TRACKER - API TESTS
   Tests with Community Feature
   ===================================================== */

const request = require('supertest');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

let app;
let Category, Donation, Settings, Post;
let testCategoryId;

// Content filter function
function filterProfanity(text) {
    const badWords = ['chutiya', 'madarchod', 'fuck', 'shit', 'hate'];
    const lowerText = text.toLowerCase();
    for (const word of badWords) {
        if (lowerText.includes(word)) return false;
    }
    return true;
}

beforeAll(async () => {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Schemas
    const categorySchema = new mongoose.Schema({
        name: { type: String, required: true },
        order: { type: Number, default: 0 }
    });

    const donationSchema = new mongoose.Schema({
        donorName: { type: String, required: true },
        amount: { type: Number, required: true },
        date: { type: Date, required: true },
        categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
        notes: { type: String, default: '' },
        status: { type: String, default: 'approved' }
    });

    const settingsSchema = new mongoose.Schema({
        adminPassword: { type: String, required: true },
        viewMode: { type: String, default: 'cards' },
        communityEnabled: { type: Boolean, default: false }
    });

    const postSchema = new mongoose.Schema({
        content: { type: String, required: true, maxLength: 500 },
        imageUrl: { type: String, default: '' },
        ipAddress: { type: String, required: true },
        userAgent: { type: String },
        replies: [{
            content: { type: String, required: true },
            ipAddress: { type: String, required: true },
            createdAt: { type: Date, default: Date.now }
        }],
        isVisible: { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now }
    });

    Category = mongoose.models.Category || mongoose.model('Category', categorySchema);
    Donation = mongoose.models.Donation || mongoose.model('Donation', donationSchema);
    Settings = mongoose.models.Settings || mongoose.model('Settings', settingsSchema);
    Post = mongoose.models.Post || mongoose.model('Post', postSchema);

    // Express app
    app = express();
    app.use(cors());
    app.use(express.json());

    // Auth
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

    // Categories
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

    // Donations
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

    // Stats
    app.get('/api/stats', async (req, res) => {
        const totalDonors = await Donation.countDocuments();
        const result = await Donation.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
        const totalCategories = await Category.countDocuments();
        res.json({ totalDonors, totalAmount: result[0]?.total || 0, totalCategories });
    });

    // Community routes
    app.get('/api/community', async (req, res) => {
        const settings = await Settings.findOne();
        if (!settings?.communityEnabled) {
            return res.status(403).json({ message: 'Community disabled' });
        }
        const posts = await Post.find({ isVisible: true }).sort({ createdAt: -1 });
        res.json(posts);
    });

    app.post('/api/community', async (req, res) => {
        const settings = await Settings.findOne();
        if (!settings?.communityEnabled) {
            return res.status(403).json({ message: 'Community disabled' });
        }
        const { content } = req.body;
        if (!content || content.length > 500) {
            return res.status(400).json({ message: 'Invalid content' });
        }
        if (!filterProfanity(content)) {
            return res.status(400).json({ message: 'Inappropriate content' });
        }
        const post = await Post.create({
            content,
            ipAddress: req.ip || 'test-ip',
            userAgent: req.headers['user-agent'] || 'test'
        });
        res.status(201).json(post);
    });

    app.post('/api/community/:id/reply', async (req, res) => {
        const { content } = req.body;
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ message: 'Not found' });
        post.replies.push({ content, ipAddress: req.ip || 'test-ip' });
        await post.save();
        res.json(post);
    });

    app.delete('/api/community/:id', async (req, res) => {
        await Post.findByIdAndDelete(req.params.id);
        res.json({ message: 'deleted' });
    });

    app.put('/api/settings/community', async (req, res) => {
        const { enabled } = req.body;
        const settings = await Settings.findOne();
        settings.communityEnabled = enabled;
        await settings.save();
        res.json({ communityEnabled: settings.communityEnabled });
    });
});

afterAll(async () => {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
});

// Tests
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
            .send({ name: 'TEST_CAT_' + Date.now() });
        expect(res.statusCode).toBe(201);
        testCategoryId = res.body._id;
    });

    test('get categories', async () => {
        const res = await request(app).get('/api/categories');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

describe('💰 Donations API', () => {
    let tempCatId, tempDonationId;

    beforeAll(async () => {
        const cat = await Category.create({ name: 'TEMP_DONATION_TEST', order: 999 });
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

describe('💬 Community API', () => {
    let testPostId;

    beforeAll(async () => {
        // Enable community
        const settings = await Settings.findOne();
        settings.communityEnabled = true;
        await settings.save();
    });

    afterAll(async () => {
        if (testPostId) await Post.findByIdAndDelete(testPostId);
        // Disable community
        const settings = await Settings.findOne();
        settings.communityEnabled = false;
        await settings.save();
    });

    test('create community post', async () => {
        const res = await request(app)
            .post('/api/community')
            .send({ content: 'This is a test post' });
        expect(res.statusCode).toBe(201);
        expect(res.body.content).toBe('This is a test post');
        testPostId = res.body._id;
    });

    test('reject post with profanity', async () => {
        const res = await request(app)
            .post('/api/community')
            .send({ content: 'This is fuck test' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toContain('Inappropriate');
    });

    test('add reply to post', async () => {
        const res = await request(app)
            .post(`/api/community/${testPostId}/reply`)
            .send({ content: 'Test reply' });
        expect(res.statusCode).toBe(200);
        expect(res.body.replies.length).toBeGreaterThan(0);
    });

    test('get community posts', async () => {
        const res = await request(app).get('/api/community');
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('delete community post', async () => {
        const res = await request(app).delete(`/api/community/${testPostId}`);
        expect(res.statusCode).toBe(200);
        testPostId = null; // Prevent double-delete in afterAll
    });
});

console.log(`
╔═══════════════════════════════════════════════════════╗
║  🛕 Temple Tracker - Tests with Community Feature     ║
╚═══════════════════════════════════════════════════════╝
`);
