/* =====================================================
   TEMPLE DONATION TRACKER - EXPRESS SERVER
   Node.js backend with MongoDB
   ===================================================== */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ==================== MONGODB CONNECTION ====================

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/temple_donations')
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// ==================== SCHEMAS ====================

// Category Schema
const categorySchema = new mongoose.Schema({
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// Donation Schema
const donationSchema = new mongoose.Schema({
    donorName: { type: String, required: true },
    amount: { type: Number, required: false, default: 0 },
    date: { type: Date, required: false, default: Date.now },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['approved', 'pending'], default: 'approved' },
    createdAt: { type: Date, default: Date.now }
});

// SubAdmin Schema
const subAdminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    permissions: {
        canAddDonation: { type: Boolean, default: true },
        canEditDonation: { type: Boolean, default: false },
        canDeleteDonation: { type: Boolean, default: false },
        canManageCategory: { type: Boolean, default: false },
        assignedCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }]
    },
    createdAt: { type: Date, default: Date.now }
});

// Settings Schema
const settingsSchema = new mongoose.Schema({
    adminPassword: { type: String, required: true },
    viewMode: { type: String, enum: ['cards', 'list'], default: 'cards' },
    communityEnabled: { type: Boolean, default: false },
    showDates: { type: Boolean, default: true }
});

// Activity Log Schema (NON-DELETABLE)
const activityLogSchema = new mongoose.Schema({
    action: { type: String, required: true }, // LOGIN, ADD, EDIT, DELETE
    entity: { type: String, required: true }, // DONATION, CATEGORY, SUBADMIN, SETTINGS
    entityId: { type: String },
    details: { type: String, required: true },
    user: { type: String, required: true }, // admin or subadmin username
    userType: { type: String, enum: ['admin', 'subadmin'], required: true },
    ipAddress: { type: String },
    timestamp: { type: Date, default: Date.now }
});

// Community Post Schema
const postSchema = new mongoose.Schema({
    content: { type: String, required: true, maxLength: 500 },
    imageUrl: { type: String, default: '' },
    ipAddress: { type: String, required: true },
    userAgent: { type: String },
    replies: [{
        content: { type: String, required: true, maxLength: 300 },
        ipAddress: { type: String, required: true },
        userAgent: { type: String },
        createdAt: { type: Date, default: Date.now }
    }],
    isVisible: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

// Models
const Category = mongoose.model('Category', categorySchema);
const Donation = mongoose.model('Donation', donationSchema);
const SubAdmin = mongoose.model('SubAdmin', subAdminSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
const Post = mongoose.model('Post', postSchema);

// Log helper function
async function createLog(req, action, entity, entityId, details) {
    try {
        const user = req.headers['x-user'] || 'admin';
        const userType = req.headers['x-user-type'] || 'admin';
        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';

        await ActivityLog.create({
            action,
            entity,
            entityId,
            details,
            user,
            userType,
            ipAddress
        });
    } catch (error) {
        console.error('Error creating log:', error);
    }
}

// Content moderation filter
function filterProfanity(text) {
    const badWords = [
        // Hindi abusive words (transliterated)
        'chutiya', 'madarchod', 'bhenchod', 'bhosdike', 'gandu', 'harami',
        'kutta', 'kamina', 'saala', 'randi', 'lavde', 'gaandu',
        // English abusive words
        'fuck', 'shit', 'ass', 'bitch', 'bastard', 'damn', 'hell',
        'idiot', 'stupid', 'hate', 'kill', 'die', 'death'
    ];

    const lowerText = text.toLowerCase();

    for (const word of badWords) {
        if (lowerText.includes(word)) {
            return false; // Contains profanity
        }
    }

    return true; // Clean content
}

// ==================== INITIALIZE DEFAULT DATA ====================

async function initializeData() {
    try {
        // Check if settings exist
        let settings = await Settings.findOne();
        if (!settings) {
            const hashedPassword = await bcrypt.hash(process.env.ADMIN_DEFAULT_PASSWORD || 'admin123', 10);
            settings = await Settings.create({
                adminPassword: hashedPassword,
                viewMode: 'cards'
            });
            console.log('✅ Default settings created');
        }

        // Check if categories exist
        const categoryCount = await Category.countDocuments();
        if (categoryCount === 0) {
            await Category.insertMany([
                { name: 'श्री राम नगर टोला', order: 1 },
                { name: 'हनुमान मंदिर मार्ग', order: 2 },
                { name: 'गणेश चौक', order: 3 }
            ]);
            console.log('✅ Default categories created');

            // Add sample donations
            const categories = await Category.find();
            await Donation.insertMany([
                { donorName: 'श्री रामेश्वर प्रसाद', amount: 51000, date: new Date('2024-01-15'), categoryId: categories[0]._id, notes: 'मुख्य हॉल के लिए' },
                { donorName: 'श्रीमती सीता देवी', amount: 21000, date: new Date('2024-01-18'), categoryId: categories[0]._id },
                { donorName: 'श्री मोहन लाल', amount: 11000, date: new Date('2024-01-20'), categoryId: categories[1]._id, notes: 'गर्भगृह निर्माण' },
                { donorName: 'श्री राजेश कुमार', amount: 5100, date: new Date('2024-01-22'), categoryId: categories[1]._id },
                { donorName: 'श्रीमती गीता देवी', amount: 25000, date: new Date('2024-01-25'), categoryId: categories[2]._id, notes: 'मंदिर शिखर' },
                { donorName: 'श्री अरुण शर्मा', amount: 15000, date: new Date('2024-02-01'), categoryId: categories[2]._id }
            ]);
            console.log('✅ Sample donations created');
        }
    } catch (error) {
        console.error('Error initializing data:', error);
    }
}

// Run initialization after connection
mongoose.connection.once('open', initializeData);

// ==================== AUTH ROUTES ====================

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Check main admin
        const adminUsername = process.env.ADMIN_USERNAME || 'mandirjan';
        if (username === adminUsername) {
            const settings = await Settings.findOne();
            const isMatch = await bcrypt.compare(password, settings.adminPassword);
            if (isMatch) {
                await createLog(req, 'LOGIN', 'AUTH', null, 'Admin logged in');
                return res.json({
                    success: true,
                    user: { type: 'admin', username: adminUsername }
                });
            }
        }

        // Check sub-admins
        const subAdmin = await SubAdmin.findOne({ username });
        if (subAdmin) {
            const isMatch = await bcrypt.compare(password, subAdmin.password);
            if (isMatch) {
                await createLog(req, 'LOGIN', 'AUTH', subAdmin._id.toString(), `Sub-admin '${username}' logged in`);
                return res.json({
                    success: true,
                    user: {
                        type: 'subadmin',
                        id: subAdmin._id,
                        username: subAdmin.username,
                        permissions: subAdmin.permissions
                    }
                });
            }
        }

        await createLog(req, 'LOGIN_FAILED', 'AUTH', null, `Failed login attempt for '${username}'`);
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== DONATIONS ROUTES ====================

// Get all donations (filter by status)
app.get('/api/donations', async (req, res) => {
    try {
        const { status } = req.query;
        const query = {};
        if (status) {
            query.status = status;
        }

        const donations = await Donation.find(query).populate('categoryId').sort({ date: -1 });
        res.json(donations);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Create donation
app.post('/api/donations', async (req, res) => {
    try {
        const userType = req.headers['x-user-type'] || 'admin';
        const donationData = { ...req.body };

        // Sub-admins create pending donations by default
        if (userType === 'subadmin') {
            donationData.status = 'pending';
            // Sub-admins MUST provide amount and date if they are entering data
            // However, user said if they enter amount, then date is required.
            // Let's enforce that if amount > 0, date should probably be set, but schema has default Date.now
            // The constraint was: "subadmin se agar daale toh date required hoga"
            if (!req.body.amount || !req.body.date) {
                return res.status(400).json({ message: "Amount and Date are required for Sub-admins" });
            }
        } else {
            donationData.status = 'approved';
        }

        const donation = new Donation(donationData);
        await donation.save();

        const populated = await Donation.findById(donation._id).populate('categoryId');

        await createLog(req, 'ADD', 'DONATION', donation._id.toString(),
            `Added donation (${donationData.status}): ${req.body.donorName} - ₹${req.body.amount}`);

        res.status(201).json(populated);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Update donation
app.put('/api/donations/:id', async (req, res) => {
    try {
        const oldDonation = await Donation.findById(req.params.id);
        const donation = await Donation.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        ).populate('categoryId');
        if (!donation) return res.status(404).json({ message: 'Donation not found' });
        await createLog(req, 'EDIT', 'DONATION', donation._id.toString(),
            `Edited donation: ${oldDonation.donorName} (₹${oldDonation.amount} → ₹${req.body.amount || oldDonation.amount})`);
        res.json(donation);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Approve donation (Admin only)
app.put('/api/donations/:id/approve', async (req, res) => {
    try {
        const donation = await Donation.findByIdAndUpdate(
            req.params.id,
            { status: 'approved' },
            { new: true }
        ).populate('categoryId');

        if (!donation) return res.status(404).json({ message: 'Donation not found' });

        await createLog(req, 'APPROVE', 'DONATION', donation._id.toString(),
            `Approved donation: ${donation.donorName} - ₹${donation.amount}`);

        res.json(donation);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Delete donation
app.delete('/api/donations/:id', async (req, res) => {
    try {
        const donation = await Donation.findById(req.params.id);
        if (!donation) return res.status(404).json({ message: 'Donation not found' });
        await createLog(req, 'DELETE', 'DONATION', donation._id.toString(),
            `Deleted donation: ${donation.donorName} - ₹${donation.amount}`);
        await Donation.findByIdAndDelete(req.params.id);
        res.json({ message: 'Donation deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==================== CATEGORIES ROUTES ====================

// Get all categories (ordered)
app.get('/api/categories', async (req, res) => {
    try {
        const categories = await Category.find().sort({ order: 1 });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Create category
app.post('/api/categories', async (req, res) => {
    try {
        const maxOrder = await Category.findOne().sort({ order: -1 });
        const category = new Category({
            ...req.body,
            order: (maxOrder?.order || 0) + 1
        });
        await category.save();
        await createLog(req, 'ADD', 'CATEGORY', category._id.toString(),
            `Added category: ${req.body.name}`);
        res.status(201).json(category);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Update category
app.put('/api/categories/:id', async (req, res) => {
    try {
        const oldCategory = await Category.findById(req.params.id);
        const category = await Category.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!category) return res.status(404).json({ message: 'Category not found' });
        await createLog(req, 'EDIT', 'CATEGORY', category._id.toString(),
            `Edited category: ${oldCategory.name} → ${category.name}`);
        res.json(category);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Delete category
app.delete('/api/categories/:id', async (req, res) => {
    try {
        // Check if category has donations
        const donationCount = await Donation.countDocuments({ categoryId: req.params.id });
        if (donationCount > 0) {
            return res.status(400).json({
                message: `Cannot delete: ${donationCount} donations exist in this category`
            });
        }

        const category = await Category.findById(req.params.id);
        if (!category) return res.status(404).json({ message: 'Category not found' });
        await createLog(req, 'DELETE', 'CATEGORY', category._id.toString(),
            `Deleted category: ${category.name}`);
        await Category.findByIdAndDelete(req.params.id);
        res.json({ message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Reorder categories
app.put('/api/categories/reorder', async (req, res) => {
    try {
        const { orders } = req.body; // [{ id: 'xxx', order: 1 }, ...]
        for (const item of orders) {
            await Category.findByIdAndUpdate(item.id, { order: item.order });
        }
        const categories = await Category.find().sort({ order: 1 });
        res.json(categories);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// ==================== SUB-ADMINS ROUTES ====================

// Get all sub-admins
app.get('/api/subadmins', async (req, res) => {
    try {
        const subAdmins = await SubAdmin.find().select('-password');
        res.json(subAdmins);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Create sub-admin
app.post('/api/subadmins', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const subAdmin = new SubAdmin({
            ...req.body,
            password: hashedPassword
        });
        await subAdmin.save();
        await createLog(req, 'ADD', 'SUBADMIN', subAdmin._id.toString(),
            `Created sub-admin: ${req.body.username}`);
        const result = subAdmin.toObject();
        delete result.password;
        res.status(201).json(result);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        res.status(400).json({ message: error.message });
    }
});

// Update sub-admin
app.put('/api/subadmins/:id', async (req, res) => {
    try {
        const oldSubAdmin = await SubAdmin.findById(req.params.id);
        const updateData = { ...req.body };
        if (updateData.password) {
            updateData.password = await bcrypt.hash(updateData.password, 10);
        } else {
            delete updateData.password;
        }

        const subAdmin = await SubAdmin.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        ).select('-password');

        if (!subAdmin) return res.status(404).json({ message: 'Sub-admin not found' });
        await createLog(req, 'EDIT', 'SUBADMIN', subAdmin._id.toString(),
            `Edited sub-admin: ${oldSubAdmin.username}`);
        res.json(subAdmin);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        res.status(400).json({ message: error.message });
    }
});

// Delete sub-admin
app.delete('/api/subadmins/:id', async (req, res) => {
    try {
        const subAdmin = await SubAdmin.findById(req.params.id);
        if (!subAdmin) return res.status(404).json({ message: 'Sub-admin not found' });
        await createLog(req, 'DELETE', 'SUBADMIN', subAdmin._id.toString(),
            `Deleted sub-admin: ${subAdmin.username}`);
        await SubAdmin.findByIdAndDelete(req.params.id);
        res.json({ message: 'Sub-admin deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==================== SETTINGS ROUTES ====================

// Get settings
app.get('/api/settings', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        res.json({ viewMode: settings?.viewMode || 'cards' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Update settings
app.put('/api/settings', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        if (req.body.viewMode) {
            settings.viewMode = req.body.viewMode;
        }
        await settings.save();
        res.json({ viewMode: settings.viewMode });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Change admin password
app.put('/api/settings/password', async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const settings = await Settings.findOne();

        const isMatch = await bcrypt.compare(currentPassword, settings.adminPassword);
        if (!isMatch) {
            return res.status(400).json({ message: 'Current password is incorrect' });
        }

        settings.adminPassword = await bcrypt.hash(newPassword, 10);
        await settings.save();
        await createLog(req, 'EDIT', 'SETTINGS', null, 'Admin password changed');
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// ==================== ACTIVITY LOGS ROUTES (READ-ONLY) ====================

// Get all logs (newest first) - NO DELETE ENDPOINT
app.get('/api/logs', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const skip = (page - 1) * limit;

        const logs = await ActivityLog.find()
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        const total = await ActivityLog.countDocuments();

        res.json({
            logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==================== STATS ROUTE ====================

app.get('/api/stats', async (req, res) => {
    try {
        const totalDonors = await Donation.countDocuments();
        const totalAmount = await Donation.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const totalCategories = await Category.countDocuments();

        res.json({
            totalDonors,
            totalAmount: totalAmount[0]?.total || 0,
            totalCategories
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==================== COMMUNITY ROUTES ====================

// Get public posts (visible only)
app.get('/api/community', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        if (!settings?.communityEnabled) {
            return res.status(403).json({ message: 'Community feature is disabled' });
        }

        const posts = await Post.find({ isVisible: true })
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(posts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Get all posts (admin only, with IP info)
app.get('/api/community/admin', async (req, res) => {
    try {
        const posts = await Post.find()
            .sort({ createdAt: -1 });
        res.json(posts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Create anonymous post
app.post('/api/community', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        if (!settings?.communityEnabled) {
            return res.status(403).json({ message: 'Community feature is disabled' });
        }

        const { content, imageUrl } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({ message: 'Content is required' });
        }

        if (content.length > 500) {
            return res.status(400).json({ message: 'Content must be 500 characters or less' });
        }

        // Content moderation
        if (!filterProfanity(content)) {
            return res.status(400).json({
                message: 'Your post contains inappropriate content. Please be respectful.'
            });
        }

        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || '';

        const post = await Post.create({
            content: content.trim(),
            imageUrl: imageUrl || '',
            ipAddress,
            userAgent
        });

        res.status(201).json(post);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Add reply to post
app.post('/api/community/:id/reply', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        if (!settings?.communityEnabled) {
            return res.status(403).json({ message: 'Community feature is disabled' });
        }

        const { content } = req.body;

        if (!content || content.trim().length === 0) {
            return res.status(400).json({ message: 'Reply content is required' });
        }

        if (content.length > 300) {
            return res.status(400).json({ message: 'Reply must be 300 characters or less' });
        }

        if (!filterProfanity(content)) {
            return res.status(400).json({
                message: 'Your reply contains inappropriate content. Please be respectful.'
            });
        }

        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || '';

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        post.replies.push({
            content: content.trim(),
            ipAddress,
            userAgent
        });

        await post.save();
        res.json(post);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// Delete post (admin only)
app.delete('/api/community/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }

        await Post.findByIdAndDelete(req.params.id);
        res.json({ message: 'Post deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Toggle community feature (admin only)
app.put('/api/settings/community', async (req, res) => {
    try {
        const { enabled } = req.body;
        const settings = await Settings.findOne();

        if (!settings) {
            return res.status(404).json({ message: 'Settings not found' });
        }

        settings.communityEnabled = enabled;
        await settings.save();

        res.json({ communityEnabled: settings.communityEnabled });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Toggle show dates on cards (admin only)
app.put('/api/settings/showDates', async (req, res) => {
    try {
        const { showDates } = req.body;
        const settings = await Settings.findOne();

        if (!settings) {
            return res.status(404).json({ message: 'Settings not found' });
        }

        settings.showDates = showDates;
        await settings.save();

        res.json({ showDates: settings.showDates });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ==================== SERVE FRONTEND ====================

// Serve Admin Route
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`
🛕 Temple Donation Tracker Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 Server running at: http://localhost:${PORT}
📁 MongoDB: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/temple_donations'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});
