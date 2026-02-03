/* =====================================================
   TEMPLE DONATION TRACKER - APP LOGIC
   Frontend with MongoDB API integration
   ===================================================== */

// API Base URL
const API_URL = '';

// Current user session
let currentUser = null;

// Cache for data
let categoriesCache = [];
let donationsCache = [];
let settingsCache = { viewMode: 'cards' };

// ==================== API HELPERS ====================

async function apiGet(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
}

async function apiPost(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Request failed');
    }
    return response.json();
}

async function apiPut(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Request failed');
    }
    return response.json();
}

async function apiDelete(endpoint) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'DELETE'
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Request failed');
    }
    return response.json();
}

// ==================== DATA LOADING ====================

async function loadAllData() {
    try {
        const [categories, donations, settings] = await Promise.all([
            apiGet('/api/categories'),
            apiGet('/api/donations'),
            apiGet('/api/settings')
        ]);

        categoriesCache = categories;
        donationsCache = donations;
        settingsCache = settings;

        return { categories, donations, settings };
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Error loading data', 'error');
    }
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
}

// Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

// ==================== UI RENDERING ====================

// Initialize app
async function initApp() {
    showLoading(true);
    await loadAllData();
    renderPublicView();
    updateStats();
    populateCategoryFilter();
    setupEventListeners();
    applyViewMode();
    showLoading(false);
}

function showLoading(show) {
    // Simple loading indicator
    const container = document.getElementById('donationsContainer');
    if (show) {
        container.innerHTML = '<div style="text-align: center; padding: 3rem; color: var(--text-muted);"><span style="font-size: 3rem;">🕉️</span><p>Loading...</p></div>';
    }
}

// Helper to group donations by donor
function groupDonationsByName(donations) {
    const grouped = {};

    donations.forEach(d => {
        // Normalize name for grouping (case-insensitive)
        const nameKey = d.donorName.trim().toLowerCase() + '_' + (d.categoryId?._id || d.categoryId || 'unknown');

        if (!grouped[nameKey]) {
            grouped[nameKey] = {
                donorName: d.donorName.trim(),
                amount: 0,
                history: [],
                categoryId: d.categoryId,
                date: d.date, // Will track latest date
                notes: d.notes,
                _id: d._id // Use one ID for key if needed
            };
        }

        const amount = d.amount || 0;
        grouped[nameKey].amount += amount;

        // Track latest date
        if (new Date(d.date) > new Date(grouped[nameKey].date)) {
            grouped[nameKey].date = d.date;
        }

        grouped[nameKey].history.push({
            amount: amount,
            date: d.date,
            notes: d.notes
        });
    });

    return Object.values(grouped);
}

// Render public donations view
function renderPublicView(searchTerm = '', categoryFilter = '', statusFilter = '') {
    const container = document.getElementById('donationsContainer');
    const emptyState = document.getElementById('emptyState');

    // Sort categories by order
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);

    // 1. Filter Approved Donations
    let rawDonations = donationsCache.filter(d => d.status === 'approved');

    // 2. Group Donations by Name
    let groupedDonors = groupDonationsByName(rawDonations);

    // 3. Apply Search
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        groupedDonors = groupedDonors.filter(d => {
            const donorLower = d.donorName.toLowerCase();
            if (donorLower.includes(term)) return true;
            const searchable = donorLower + ' ' + transliterateHindiToEnglish(d.donorName);
            return searchable.includes(term);
        });
    }

    // 4. Apply Category Filter
    if (categoryFilter) {
        groupedDonors = groupedDonors.filter(d => {
            const catId = d.categoryId?._id || d.categoryId;
            return catId === categoryFilter;
        });
    }

    // 5. Apply Status Filter (Paid vs Pledged)
    if (statusFilter === 'paid') {
        groupedDonors = groupedDonors.filter(d => d.amount > 0);
    } else if (statusFilter === 'pledged') {
        groupedDonors = groupedDonors.filter(d => d.amount === 0);
    }

    if (groupedDonors.length === 0) {
        container.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Group by category for display
    if (!categoryFilter) {
        let html = '';
        sortedCategories.forEach(category => {
            // Filter grouped donors for this category
            const categoryDonors = groupedDonors.filter(d => {
                const catId = d.categoryId?._id || d.categoryId;
                return catId === category._id;
            });

            // Sort by amount (desc) or date
            categoryDonors.sort((a, b) => b.amount - a.amount);

            if (categoryDonors.length > 0) {
                html += `
                    <div class="category-section">
                        <div class="category-header">
                            <h2>📍 ${category.name}</h2>
                            <span class="count">${categoryDonors.length} donors</span>
                        </div>
                        <div class="donations-grid ${settingsCache.viewMode === 'list' ? 'list-view' : ''}">
                            ${categoryDonors.map((d, i) => renderDonorCard(d, i)).join('')}
                        </div>
                    </div>
                `;
            }
        });
        container.innerHTML = html;
    } else {
        // Sort by amount (desc)
        groupedDonors.sort((a, b) => b.amount - a.amount);

        container.innerHTML = `
            <div class="donations-grid ${settingsCache.viewMode === 'list' ? 'list-view' : ''}">
                ${groupedDonors.map((d, i) => renderDonorCard(d, i)).join('')}
            </div>
        `;
    }

    // Apply view mode class
    document.querySelectorAll('.donations-grid').forEach(grid => {
        grid.className = `donations-container ${settingsCache.viewMode === 'list' ? 'list-view' : ''}`;
    });
}

// Render grouped donor card
function renderDonorCard(donor, index) {
    const category = donor.categoryId?.name || 'Unknown';
    const delay = index * 0.1;

    // Create history list if more than 1 donation
    let historyHtml = '';
    if (donor.history.length > 1) {
        historyHtml = `<div class="donation-history">`;
        donor.history.forEach(h => {
            // Only show history items if they have amount > 0 or it's a pledge note
            if (h.amount > 0 || h.notes) {
                historyHtml += `
                    <div class="history-item">
                        <span>₹${h.amount}</span>
                        <span class="text-muted text-xs">${formatDate(h.date)}</span>
                    </div>
                `;
            }
        });
        historyHtml += `</div>`;
    }

    return `
        <div class="donation-card" style="animation-delay: ${delay}s">
            <div class="donor-name">${donor.donorName}</div>
            
            <div class="amount-section">
               <div class="amount">${donor.amount > 0 ? formatCurrency(donor.amount) : 'Pledged'}</div>
               <span class="label text-xs">Total Contribution</span>
            </div>

            ${historyHtml}

            <div class="meta">
                <span class="category-tag">${category}</span>
                <span class="date">📅 Last: ${formatDate(donor.date)}</span>
            </div>
            ${donor.notes ? `<div class="notes">"${donor.notes}"</div>` : ''}
        </div>
    `;
}

// Update statistics
async function updateStats() {
    try {
        const stats = await apiGet('/api/stats');
        document.getElementById('totalDonors').textContent = stats.totalDonors;
        document.getElementById('totalAmount').textContent = formatCurrency(stats.totalAmount);
        document.getElementById('totalCategories').textContent = stats.totalCategories;
    } catch (error) {
        console.error('Error updating stats:', error);
    }
}

// Populate category filter dropdown
function populateCategoryFilter() {
    const select = document.getElementById('categoryFilter');
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);

    select.innerHTML = '<option value="">All Categories</option>';
    sortedCategories.forEach(cat => {
        select.innerHTML += `<option value="${cat._id}">${cat.name}</option>`;
    });
}

// Apply view mode
function applyViewMode() {
    document.querySelectorAll('.toggle-btn[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === settingsCache.viewMode);
    });

    document.querySelectorAll('.donations-grid, .donations-container').forEach(container => {
        container.classList.toggle('list-view', settingsCache.viewMode === 'list');
    });
}

// Set view mode
async function setViewMode(mode) {
    try {
        await apiPut('/api/settings', { viewMode: mode });
        settingsCache.viewMode = mode;
        applyViewMode();
        renderPublicView(
            document.getElementById('searchInput').value,
            document.getElementById('categoryFilter').value
        );
        showToast('View mode updated', 'success');
    } catch (error) {
        showToast('Error updating view mode', 'error');
    }
}

// ==================== ADMIN PANEL ====================

// Render admin donations table
function renderAdminDonations() {
    const tbody = document.getElementById('donationsTableBody');

    // Sort donations by date (newest first)
    const sortedDonations = [...donationsCache].sort((a, b) =>
        new Date(b.date) - new Date(a.date)
    );

    tbody.innerHTML = sortedDonations.map(donation => {
        const category = donation.categoryId?.name ||
            categoriesCache.find(c => c._id === donation.categoryId)?.name || 'Unknown';
        const canEdit = canUserEdit();
        const canDelete = canUserDelete();

        return `
            <tr>
                <td>${donation.donorName}</td>
                <td>${formatCurrency(donation.amount)}</td>
                <td>${formatDate(donation.date)}</td>
                <td>${category}</td>
                <td class="actions">
                    ${canEdit ? `<button class="btn btn-sm btn-outline" onclick="editDonation('${donation._id}')">✏️</button>` : ''}
                    ${canDelete ? `<button class="btn btn-sm btn-danger" onclick="deleteDonation('${donation._id}')">🗑️</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Render admin categories list
function renderAdminCategories() {
    const container = document.getElementById('categoriesList');
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);
    const canManage = canUserManageCategory();

    container.innerHTML = sortedCategories.map((category, index) => {
        const donationCount = donationsCache.filter(d => {
            const catId = d.categoryId?._id || d.categoryId;
            return catId === category._id;
        }).length;

        return `
            <div class="category-item" data-id="${category._id}">
                <span class="drag-handle">⋮⋮</span>
                <span class="category-name">${category.name}</span>
                <span class="category-count">${donationCount} donations</span>
                ${canManage ? `
                    <div class="order-btns">
                        <button class="order-btn" onclick="moveCategoryUp('${category._id}')" ${index === 0 ? 'disabled' : ''}>▲</button>
                        <button class="order-btn" onclick="moveCategoryDown('${category._id}')" ${index === sortedCategories.length - 1 ? 'disabled' : ''}>▼</button>
                    </div>
                    <button class="btn btn-sm btn-outline" onclick="editCategory('${category._id}')">✏️</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCategory('${category._id}')">🗑️</button>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Render sub-admins list
async function renderSubAdmins() {
    const container = document.getElementById('subadminsList');

    try {
        const subAdmins = await apiGet('/api/subadmins');

        if (subAdmins.length === 0) {
            container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No sub-admins created yet</p>';
            return;
        }

        container.innerHTML = subAdmins.map(subadmin => {
            const perms = subadmin.permissions;
            const assignedCats = categoriesCache.filter(c =>
                perms.assignedCategories.length === 0 || perms.assignedCategories.includes(c._id)
            );

            return `
                <div class="subadmin-card">
                    <div class="subadmin-header">
                        <span class="subadmin-username">👤 ${subadmin.username}</span>
                        <div class="actions">
                            <button class="btn btn-sm btn-outline" onclick="editSubAdmin('${subadmin._id}')">✏️ Edit</button>
                            <button class="btn btn-sm btn-danger" onclick="deleteSubAdmin('${subadmin._id}')">🗑️ Delete</button>
                        </div>
                    </div>
                    <div class="subadmin-permissions">
                        <span class="permission-badge ${perms.canAddDonation ? '' : 'inactive'}">Add Donations</span>
                        <span class="permission-badge ${perms.canEditDonation ? '' : 'inactive'}">Edit Donations</span>
                        <span class="permission-badge ${perms.canDeleteDonation ? '' : 'inactive'}">Delete Donations</span>
                        <span class="permission-badge ${perms.canManageCategory ? '' : 'inactive'}">Manage Categories</span>
                    </div>
                    <p style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">
                        Categories: ${assignedCats.map(c => c.name).join(', ') || 'All'}
                    </p>
                </div>
            `;
        }).join('');
    } catch (error) {
        container.innerHTML = '<p style="color: var(--error); text-align: center;">Error loading sub-admins</p>';
    }
}

// ==================== PERMISSIONS ====================

function canUserAdd() {
    if (!currentUser) return false;
    if (currentUser.type === 'admin') return true;
    return currentUser.permissions?.canAddDonation;
}

function canUserEdit() {
    if (!currentUser) return false;
    if (currentUser.type === 'admin') return true;
    return currentUser.permissions?.canEditDonation;
}

function canUserDelete() {
    if (!currentUser) return false;
    if (currentUser.type === 'admin') return true;
    return currentUser.permissions?.canDeleteDonation;
}

function canUserManageCategory() {
    if (!currentUser) return false;
    if (currentUser.type === 'admin') return true;
    return currentUser.permissions?.canManageCategory;
}

function canUserAccessCategory(categoryId) {
    if (!currentUser) return false;
    if (currentUser.type === 'admin') return true;
    const perms = currentUser.permissions;
    return !perms.assignedCategories?.length || perms.assignedCategories.includes(categoryId);
}

// Update UI based on permissions
function updateAdminUIPermissions() {
    const addDonationBtn = document.getElementById('addDonationBtn');
    const addCategoryBtn = document.getElementById('addCategoryBtn');
    const addSubAdminBtn = document.getElementById('addSubAdminBtn');

    if (addDonationBtn) addDonationBtn.style.display = canUserAdd() ? 'flex' : 'none';
    if (addCategoryBtn) addCategoryBtn.style.display = canUserManageCategory() ? 'flex' : 'none';
    if (addSubAdminBtn) addSubAdminBtn.style.display = currentUser?.type === 'admin' ? 'flex' : 'none';

    // Hide sub-admins tab for non-main-admins
    const subAdminTab = document.querySelector('[data-tab="subadmins"]');
    if (subAdminTab) subAdminTab.style.display = currentUser?.type === 'admin' ? 'flex' : 'none';

    // Hide settings password change for sub-admins
    const settingsTab = document.getElementById('settingsTab');
    if (settingsTab && currentUser?.type !== 'admin') {
        const passwordSetting = settingsTab.querySelector('.setting-item:nth-child(2)');
        if (passwordSetting) passwordSetting.style.display = 'none';
    }
}

// ==================== AUTHENTICATION ====================

function openLoginModal() {
    openModal('loginModal');
}

async function handleLogin(e) {
    e.preventDefault();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const captchaInput = document.getElementById('captchaInput').value;

    // Verify Captcha
    if (parseInt(captchaInput) !== currentCaptchaResult) {
        showToast('Incorrect Captcha logic. Try again.', 'error');
        generateCaptcha();
        return;
    }

    try {
        const result = await apiPost('/api/auth/login', { username, password });

        if (result.success) {
            currentUser = result.user;
            showAdminPanel();
            closeModal('loginModal');
            document.getElementById('currentUserDisplay').textContent =
                currentUser.type === 'admin' ? '👑 Admin' : `👤 ${currentUser.username}`;
            showToast(`Welcome, ${currentUser.username}!`, 'success');
        }
    } catch (error) {
        showToast('Invalid username or password', 'error');
    }
}

function logout() {
    currentUser = null;
    hideAdminPanel();
    showToast('Logged out successfully', 'success');
}

async function showAdminPanel() {
    document.getElementById('adminPanel').classList.add('active');
    await loadAllData();
    renderPendingApprovals();
    renderAdminDonations();
    renderAdminCategories();
    renderSubAdmins();
    renderLogs();
    populateDonationCategorySelect();
    updateAdminUIPermissions();

    // Update pending badge
    const pendingCount = donationsCache.filter(d => d.status === 'pending').length;
    document.getElementById('pendingCountBadge').textContent = pendingCount;
    if (pendingCount > 0) {
        document.getElementById('pendingCountBadge').style.background = 'var(--error)';
        document.getElementById('pendingCountBadge').style.color = 'white';
    } else {
        document.getElementById('pendingCountBadge').style.background = 'rgba(255,255,255,0.1)';
    }
}

function hideAdminPanel() {
    document.getElementById('adminPanel').classList.remove('active');
}

// ==================== DONATIONS CRUD ====================

function openAddDonationModal() {
    document.getElementById('donationModalTitle').textContent = 'Add Donation';
    document.getElementById('donationForm').reset();
    document.getElementById('donationId').value = '';
    document.getElementById('donationDate').valueAsDate = new Date();
    populateDonationCategorySelect();
    openModal('donationModal');
}

function editDonation(id) {
    const donation = donationsCache.find(d => d._id === id);
    if (!donation) return;

    document.getElementById('donationModalTitle').textContent = 'Edit Donation';
    document.getElementById('donationId').value = donation._id;
    document.getElementById('donorName').value = donation.donorName;
    document.getElementById('donationAmount').value = donation.amount;
    document.getElementById('donationDate').value = donation.date.split('T')[0];
    document.getElementById('donationCategory').value = donation.categoryId?._id || donation.categoryId;
    document.getElementById('donationNotes').value = donation.notes || '';

    populateDonationCategorySelect();
    openModal('donationModal');
}

async function handleDonationSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('donationId').value;
    const donationData = {
        donorName: document.getElementById('donorName').value.trim(),
        amount: parseInt(document.getElementById('donationAmount').value),
        date: document.getElementById('donationDate').value,
        categoryId: document.getElementById('donationCategory').value,
        notes: document.getElementById('donationNotes').value.trim()
    };

    try {
        if (id) {
            await apiPut(`/api/donations/${id}`, donationData);
            showToast('Donation updated successfully', 'success');
        } else {
            const res = await apiPost('/api/donations', donationData);
            if (res.status === 'pending') {
                showToast('Donation submitted for approval', 'warning');
            } else {
                showToast('Donation added successfully', 'success');
            }
        }

        closeModal('donationModal');
        await loadAllData();
        renderAdminDonations();
        renderPublicView();
        updateStats();
    } catch (error) {
        showToast(error.message || 'Error saving donation', 'error');
    }
}

async function deleteDonation(id) {
    if (!confirm('Are you sure you want to delete this donation?')) return;

    try {
        await apiDelete(`/api/donations/${id}`);
        await loadAllData();
        renderAdminDonations();
        renderPublicView();
        updateStats();
        showToast('Donation deleted', 'success');
    } catch (error) {
        showToast(error.message || 'Error deleting donation', 'error');
    }
}

function populateDonationCategorySelect() {
    const select = document.getElementById('donationCategory');
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);

    // Filter by user's assigned categories
    const accessibleCategories = sortedCategories.filter(cat => canUserAccessCategory(cat._id));

    select.innerHTML = '<option value="">Select category</option>';
    accessibleCategories.forEach(cat => {
        select.innerHTML += `<option value="${cat._id}">${cat.name}</option>`;
    });
}

// ==================== CATEGORIES CRUD ====================

function openAddCategoryModal() {
    document.getElementById('categoryModalTitle').textContent = 'Add Category';
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryId').value = '';
    openModal('categoryModal');
}

function editCategory(id) {
    const category = categoriesCache.find(c => c._id === id);
    if (!category) return;

    document.getElementById('categoryModalTitle').textContent = 'Edit Category';
    document.getElementById('categoryId').value = category._id;
    document.getElementById('categoryName').value = category.name;
    openModal('categoryModal');
}

async function handleCategorySubmit(e) {
    e.preventDefault();

    const id = document.getElementById('categoryId').value;
    const name = document.getElementById('categoryName').value.trim();

    try {
        if (id) {
            await apiPut(`/api/categories/${id}`, { name });
            showToast('Category updated successfully', 'success');
        } else {
            await apiPost('/api/categories', { name });
            showToast('Category added successfully', 'success');
        }

        closeModal('categoryModal');
        await loadAllData();
        renderAdminCategories();
        populateCategoryFilter();
        populateDonationCategorySelect();
        updateStats();
        renderPublicView();
    } catch (error) {
        showToast(error.message || 'Error saving category', 'error');
    }
}

async function deleteCategory(id) {
    if (!confirm('Are you sure you want to delete this category?')) return;

    try {
        await apiDelete(`/api/categories/${id}`);
        await loadAllData();
        renderAdminCategories();
        populateCategoryFilter();
        updateStats();
        showToast('Category deleted', 'success');
    } catch (error) {
        showToast(error.message || 'Error deleting category', 'error');
    }
}

async function moveCategoryUp(id) {
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);
    const index = sortedCategories.findIndex(c => c._id === id);

    if (index <= 0) return;

    // Swap orders
    const orders = [
        { id: sortedCategories[index]._id, order: sortedCategories[index - 1].order },
        { id: sortedCategories[index - 1]._id, order: sortedCategories[index].order }
    ];

    try {
        await apiPut('/api/categories/reorder', { orders });
        await loadAllData();
        renderAdminCategories();
        renderPublicView();
        populateCategoryFilter();
    } catch (error) {
        showToast('Error reordering', 'error');
    }
}

async function moveCategoryDown(id) {
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);
    const index = sortedCategories.findIndex(c => c._id === id);

    if (index >= sortedCategories.length - 1) return;

    // Swap orders
    const orders = [
        { id: sortedCategories[index]._id, order: sortedCategories[index + 1].order },
        { id: sortedCategories[index + 1]._id, order: sortedCategories[index].order }
    ];

    try {
        await apiPut('/api/categories/reorder', { orders });
        await loadAllData();
        renderAdminCategories();
        renderPublicView();
        populateCategoryFilter();
    } catch (error) {
        showToast('Error reordering', 'error');
    }
}

// ==================== SUB-ADMINS CRUD ====================

function openAddSubAdminModal() {
    document.getElementById('subAdminModalTitle').textContent = 'Add Sub-Admin';
    document.getElementById('subAdminForm').reset();
    document.getElementById('subAdminId').value = '';
    document.getElementById('subAdminPassword').required = true;
    populateAssignedCategories();
    openModal('subAdminModal');
}

async function editSubAdmin(id) {
    try {
        const subAdmins = await apiGet('/api/subadmins');
        const subadmin = subAdmins.find(s => s._id === id);
        if (!subadmin) return;

        document.getElementById('subAdminModalTitle').textContent = 'Edit Sub-Admin';
        document.getElementById('subAdminId').value = subadmin._id;
        document.getElementById('subAdminUsername').value = subadmin.username;
        document.getElementById('subAdminPassword').value = '';
        document.getElementById('subAdminPassword').required = false;

        document.getElementById('permAddDonation').checked = subadmin.permissions.canAddDonation;
        document.getElementById('permEditDonation').checked = subadmin.permissions.canEditDonation;
        document.getElementById('permDeleteDonation').checked = subadmin.permissions.canDeleteDonation;
        document.getElementById('permManageCategory').checked = subadmin.permissions.canManageCategory;

        populateAssignedCategories(subadmin.permissions.assignedCategories);
        openModal('subAdminModal');
    } catch (error) {
        showToast('Error loading sub-admin', 'error');
    }
}

async function handleSubAdminSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('subAdminId').value;
    const username = document.getElementById('subAdminUsername').value.trim();
    const password = document.getElementById('subAdminPassword').value;

    // Get assigned categories
    const assignedCategories = [];
    document.querySelectorAll('#assignedCategoriesGroup input:checked').forEach(cb => {
        assignedCategories.push(cb.value);
    });

    const subAdminData = {
        username,
        permissions: {
            canAddDonation: document.getElementById('permAddDonation').checked,
            canEditDonation: document.getElementById('permEditDonation').checked,
            canDeleteDonation: document.getElementById('permDeleteDonation').checked,
            canManageCategory: document.getElementById('permManageCategory').checked,
            assignedCategories
        }
    };

    if (password) {
        subAdminData.password = password;
    }

    try {
        if (id) {
            await apiPut(`/api/subadmins/${id}`, subAdminData);
            showToast('Sub-admin updated successfully', 'success');
        } else {
            if (!password) {
                showToast('Password is required for new sub-admin', 'error');
                return;
            }
            await apiPost('/api/subadmins', subAdminData);
            showToast('Sub-admin created successfully', 'success');
        }

        closeModal('subAdminModal');
        renderSubAdmins();
    } catch (error) {
        showToast(error.message || 'Error saving sub-admin', 'error');
    }
}

async function deleteSubAdmin(id) {
    if (!confirm('Are you sure you want to delete this sub-admin?')) return;

    try {
        await apiDelete(`/api/subadmins/${id}`);
        renderSubAdmins();
        showToast('Sub-admin deleted', 'success');
    } catch (error) {
        showToast(error.message || 'Error deleting sub-admin', 'error');
    }
}

function populateAssignedCategories(selected = []) {
    const container = document.getElementById('assignedCategoriesGroup');

    container.innerHTML = categoriesCache.map(cat => `
        <label class="checkbox-label">
            <input type="checkbox" value="${cat._id}" ${selected.includes(cat._id) ? 'checked' : ''}>
            <span>${cat.name}</span>
        </label>
    `).join('');
}

// ==================== SETTINGS ====================

function openChangePasswordModal() {
    document.getElementById('changePasswordForm').reset();
    openModal('changePasswordModal');
}

async function handleChangePassword(e) {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match', 'error');
        return;
    }

    try {
        await apiPut('/api/settings/password', { currentPassword, newPassword });
        closeModal('changePasswordModal');
        showToast('Password changed successfully', 'success');
    } catch (error) {
        showToast(error.message || 'Error changing password', 'error');
    }
}

async function exportData() {
    try {
        const [categories, donations, subadmins] = await Promise.all([
            apiGet('/api/categories'),
            apiGet('/api/donations'),
            apiGet('/api/subadmins')
        ]);

        const data = { categories, donations, subadmins, exportedAt: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `temple-donations-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported successfully', 'success');
    } catch (error) {
        showToast('Error exporting data', 'error');
    }
}

function importData(event) {
    showToast('Import feature requires backend implementation', 'warning');
    event.target.value = '';
}

// ==================== MODAL HELPERS ====================

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ==================== TOAST NOTIFICATIONS ====================

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.className = `toast ${type}`;
    toast.querySelector('.toast-message').textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ==================== EVENT LISTENERS ====================

function setupEventListeners() {
    // Admin toggle button
    document.getElementById('adminToggleBtn').addEventListener('click', openLoginModal);

    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);

    // Search input
    document.getElementById('searchInput').addEventListener('input', function () {
        renderPublicView(this.value, document.getElementById('categoryFilter').value);
    });

    // Category filter
    document.getElementById('categoryFilter').addEventListener('change', (e) => {
        renderPublicView(document.getElementById('searchInput').value, e.target.value);
    });

    // Payment Status filter
    document.getElementById('paymentStatusFilter').addEventListener('change', (e) => {
        renderPublicView(
            document.getElementById('searchInput').value,
            document.getElementById('categoryFilter').value,
            e.target.value
        );
    });

    // Admin tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const tabId = this.dataset.tab;

            // Update active tab button
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // Show active tab content
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById(`${tabId}Tab`).classList.add('active');
        });
    });

    // Form submissions
    document.getElementById('donationForm').addEventListener('submit', handleDonationSubmit);
    document.getElementById('categoryForm').addEventListener('submit', handleCategorySubmit);
    document.getElementById('subAdminForm').addEventListener('submit', handleSubAdminSubmit);
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('active');
            }
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
        }
    });
}

// ==================== INITIALIZE ====================

document.addEventListener('DOMContentLoaded', initApp);

// Make functions globally accessible
window.openAddDonationModal = openAddDonationModal;
window.editDonation = editDonation;
window.deleteDonation = deleteDonation;
window.openAddCategoryModal = openAddCategoryModal;
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.moveCategoryUp = moveCategoryUp;
window.moveCategoryDown = moveCategoryDown;
window.openAddSubAdminModal = openAddSubAdminModal;
window.editSubAdmin = editSubAdmin;
window.deleteSubAdmin = deleteSubAdmin;
window.openChangePasswordModal = openChangePasswordModal;
window.setViewMode = setViewMode;
window.exportData = exportData;
window.importData = importData;
window.logout = logout;
window.closeModal = closeModal;
window.downloadPDF = downloadPDF;

// ==================== TRANSLITERATION ====================

// Basic Hindi to English transliteration for search
function transliterateHindiToEnglish(text) {
    const map = {
        'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo',
        'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'अं': 'an', 'अः': 'ah',
        'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
        'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
        'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
        'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
        'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
        'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
        'ष': 'sh', 'स': 's', 'ह': 'h',
        'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo',
        'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
        'ं': 'n', 'ः': 'h', '्': '', 'ृ': 'ri',
        'श्री': 'shri', 'राम': 'ram', 'कृष्ण': 'krishna', 'हनुमान': 'hanuman',
        'प्रसाद': 'prasad', 'कुमार': 'kumar', 'सिंह': 'singh', 'शर्मा': 'sharma',
        'गुप्ता': 'gupta', 'यादव': 'yadav', 'पाण्डेय': 'pandey', 'मिश्रा': 'mishra'
    };
    let result = text;
    // Replace common words first
    for (const [hindi, eng] of Object.entries(map)) {
        result = result.replace(new RegExp(hindi, 'g'), eng);
    }
    return result.toLowerCase();
}

// ==================== PDF DOWNLOAD ====================

function downloadPDF() {
    // Create PDF content
    const sortedCategories = [...categoriesCache].sort((a, b) => a.order - b.order);
    const currentDate = new Date().toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    // Calculate totals
    const totalAmount = donationsCache.reduce((sum, d) => sum + d.amount, 0);
    const totalDonors = donationsCache.length;

    // Build HTML for PDF
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>Temple Donations Report</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600&display=swap');
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Noto Sans Devanagari', Arial, sans-serif; padding: 20px; background: #fff; color: #333; }
            .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #FF6B35; }
            .header h1 { color: #8B1538; font-size: 28px; margin-bottom: 5px; }
            .header p { color: #666; font-size: 14px; }
            .stats { display: flex; justify-content: center; gap: 40px; margin-bottom: 30px; }
            .stat { text-align: center; padding: 15px 30px; background: #FFF5E6; border-radius: 10px; }
            .stat-value { font-size: 24px; font-weight: bold; color: #FF6B35; }
            .stat-label { font-size: 12px; color: #666; }
            .category { margin-bottom: 25px; }
            .category h2 { color: #8B1538; font-size: 18px; padding: 10px 15px; background: #FFF5E6; border-left: 4px solid #FF6B35; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
            th { background: #FF6B35; color: white; padding: 10px; text-align: left; font-size: 14px; }
            td { padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; }
            tr:nth-child(even) { background: #f9f9f9; }
            .amount { font-weight: bold; color: #FF6B35; }
            .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #888; font-size: 12px; }
            @media print { body { padding: 0; } }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🛕 श्री मंदिर निर्माण दान</h1>
            <p>Temple Building Donation Report • ${currentDate}</p>
        </div>
        
        <div class="stats">
            <div class="stat">
                <div class="stat-value">${totalDonors}</div>
                <div class="stat-label">Total Donors</div>
            </div>
            <div class="stat">
                <div class="stat-value">${formatCurrency(totalAmount)}</div>
                <div class="stat-label">Total Collection</div>
            </div>
            <div class="stat">
                <div class="stat-value">${sortedCategories.length}</div>
                <div class="stat-label">Categories</div>
            </div>
        </div>
    `;

    // Add donations by category
    sortedCategories.forEach(category => {
        const categoryDonations = donationsCache.filter(d => {
            const catId = d.categoryId?._id || d.categoryId;
            return catId === category._id;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        if (categoryDonations.length > 0) {
            const catTotal = categoryDonations.reduce((sum, d) => sum + d.amount, 0);
            html += `
            <div class="category">
                <h2>📍 ${category.name} (${categoryDonations.length} donors • ${formatCurrency(catTotal)})</h2>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 5%">#</th>
                            <th style="width: 40%">Donor Name</th>
                            <th style="width: 25%">Amount</th>
                            <th style="width: 30%">Date</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            categoryDonations.forEach((donation, i) => {
                html += `
                    <tr>
                        <td>${i + 1}</td>
                        <td>${donation.donorName}</td>
                        <td class="amount">${formatCurrency(donation.amount)}</td>
                        <td>${formatDate(donation.date)}</td>
                    </tr>
                `;
            });

            html += '</tbody></table></div>';
        }
    });

    html += `
        <div class="footer">
            <p>🙏 Crafted with devotion to Hanuman Ji by Ashish 🙏</p>
            <p>Generated on ${currentDate}</p>
        </div>
    </body>
    </html>`;

    // Open print dialog
    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();

    // Wait for fonts to load then print
    setTimeout(() => {
        printWindow.print();
    }, 500);

    showToast('PDF ready for download', 'success');
}

// ==================== CAPTCHA & SPLASH ====================

let currentCaptchaResult = 0;

function generateCaptcha() {
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    currentCaptchaResult = num1 + num2;

    const captchaLabel = document.getElementById('captchaLabel');
    if (captchaLabel) {
        captchaLabel.textContent = `${num1} + ${num2} = ?`;
    }
}

function handleSplash() {
    const splash = document.getElementById('splashScreen');
    if (splash) {
        setTimeout(() => {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.display = 'none';
            }, 1000);
        }, 2000);
    }
}

// Update openLoginModal to generate captcha
const originalOpenLoginModal = openLoginModal;
openLoginModal = function () {
    originalOpenLoginModal();
    generateCaptcha();
    document.getElementById('captchaInput').value = '';
}

// ==================== PDF/PRINT EXPORT ====================

function downloadPDF() {
    // Mobile-friendly print function
    try {
        // Hide admin controls before printing
        const adminBtn = document.querySelector('.admin-btn');
        const controls = document.querySelector('.controls-bar');
        const originalDisplay = controls ? controls.style.display : '';
        const originalAdminDisplay = adminBtn ? adminBtn.style.display : '';

        if (controls) controls.style.display = 'none';
        if (adminBtn) adminBtn.style.display = 'none';

        // Trigger print
        window.print();

        // Restore after print
        setTimeout(() => {
            if (controls) controls.style.display = originalDisplay;
            if (adminBtn) adminBtn.style.display = originalAdminDisplay;
        }, 100);

        showToast('Print dialog opened. Save as PDF from print options.', 'success');
    } catch (error) {
        showToast('Please use your browser\'s print function (Ctrl+P)', 'info');
    }
}

// Export button handler
if (document.getElementById('exportBtn')) {
    document.getElementById('exportBtn').addEventListener('click', downloadPDF);
}

// ==================== CSV IMPORT ====================

// Populate category dropdown in CSV import modal
function populateCSVCategories() {
    const select = document.getElementById('csvCategoryId');
    if (select) {
        select.innerHTML = '<option value="">Choose category...</option>';
        allCategories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat._id;
            option.textContent = cat.name;
            select.appendChild(option);
        });
    }
}

// Call this when categories are loaded
window.addEventListener('categoriesLoaded', populateCSVCategories);

// Parse CSV file
function parseCSV(text, hasHeaders) {
    const lines = text.split('\n').filter(line => line.trim());
    const data = [];

    const startIndex = hasHeaders ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i];
        // Simple CSV parsing (handles basic cases)
        const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));

        if (values.length >= 3) {
            data.push({
                name: values[0],
                rashi: values[1],
                dinank: values[2]
            });
        }
    }

    return data;
}

// Handle CSV file selection
document.getElementById('csvFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        const text = await file.text();
        const hasHeaders = document.getElementById('csvHasHeaders').checked;
        const data = parseCSV(text, hasHeaders);

        // Show preview
        const preview = document.getElementById('csvPreview');
        const previewContent = document.getElementById('csvPreviewContent');

        if (data.length > 0) {
            preview.style.display = 'block';
            previewContent.innerHTML = `
                <p>Found ${data.length} rows</p>
                <table style="width: 100%; font-size: 0.9rem;">
                    <tr><th>Name</th><th>Amount</th><th>Date</th></tr>
                    ${data.slice(0, 5).map(row => `
                        <tr>
                            <td>${row.name}</td>
                            <td>${row.rashi}</td>
                            <td>${row.dinank}</td>
                        </tr>
                    `).join('')}
                    ${data.length > 5 ? '<tr><td colspan="3">... and ' + (data.length - 5) + ' more</td></tr>' : ''}
                </table>
            `;
        }
    }
});

// Handle CSV import form submission
document.getElementById('csvImportForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const categoryId = document.getElementById('csvCategoryId').value;
    const file = document.getElementById('csvFile').files[0];
    const hasHeaders = document.getElementById('csvHasHeaders').checked;

    if (!file || !categoryId) {
        showToast('Please select both category and CSV file', 'error');
        return;
    }

    try {
        const text = await file.text();
        const data = parseCSV(text, hasHeaders);

        if (data.length === 0) {
            showToast('No valid data found in CSV', 'error');
            return;
        }

        showToast(`Importing ${data.length} donations...`, 'info');

        let successCount = 0;
        let errorCount = 0;

        // Import donations one by one or in batches
        for (const row of data) {
            try {
                await apiPost('/api/donations', {
                    donorName: row.name,
                    amount: parseFloat(row.rashi) || 0,
                    date: row.dinank || new Date().toISOString(),
                    categoryId: categoryId,
                    notes: ''
                });
                successCount++;
            } catch (error) {
                errorCount++;
                console.error('Error importing row:', row, error);
            }
        }

        closeModal('csvImportModal');
        document.getElementById('csvImportForm').reset();
        document.getElementById('csvPreview').style.display = 'none';

        showToast(`Import complete! Success: ${successCount}, Errors: ${errorCount}`, 'success');

        // Refresh data
        await loadDonations();
        renderPublicView();
        if (currentUser) {
            renderDonationsTable();
        }
    } catch (error) {
        showToast('Error importing CSV: ' + error.message, 'error');
    }
});

// ==================== APPROVALS WORKFLOW ====================

function renderPendingApprovals() {
    if (!currentUser || currentUser.type !== 'admin') {
        const tab = document.getElementById('approvalsTab');
        if (tab) tab.style.display = 'none';
        return;
    }

    const tbody = document.getElementById('approvalsTableBody');
    const pending = donationsCache.filter(d => d.status === 'pending');

    if (pending.length === 0) {
        tbody.innerHTML = '';
        const msg = document.getElementById('noApprovalsMsg');
        if (msg) msg.style.display = 'block';
        return;
    }

    const msg = document.getElementById('noApprovalsMsg');
    if (msg) msg.style.display = 'none';

    tbody.innerHTML = pending.map(donation => `
        <tr>
            <td>${donation.donorName}</td>
            <td>${formatCurrency(donation.amount)}</td>
            <td>${formatDate(donation.date)}</td>
            <td>${donation.categoryId?.name || '-'}</td>
            <td>
                <button class="btn btn-sm btn-outline" onclick="approveDonation('${donation._id}')" title="Approve">✅</button>
                <button class="btn btn-sm btn-danger" onclick="deleteDonation('${donation._id}')" title="Reject">❌</button>
            </td>
        </tr>
    `).join('');
}

async function approveDonation(id) {
    try {
        await apiPut(`/api/donations/${id}/approve`, {});
        showToast('Donation approved!', 'success');
        await loadAllData();
        renderPendingApprovals();
        renderAdminDonations();
        renderPublicView();
        updateStats();

        // Update badge
        const pendingCount = donationsCache.filter(d => d.status === 'pending').length;
        const badge = document.getElementById('pendingCountBadge');
        if (badge) {
            badge.textContent = pendingCount;
            if (pendingCount > 0) {
                badge.style.background = 'var(--error)';
                badge.style.color = 'white';
            } else {
                badge.style.background = 'rgba(255,255,255,0.1)';
            }
        }
    } catch (error) {
        showToast(error.message || 'Error approving donation', 'error');
    }
}

// ==================== SEARCH & FILTER EVENT LISTENERS ====================

// Search input - real-time filtering
document.getElementById('searchInput')?.addEventListener('input', (e) => {
    const searchTerm = e.target.value;
    const categoryFilter = document.getElementById('categoryFilter')?.value || '';
    const statusFilter = document.getElementById('paymentStatusFilter')?.value || '';
    renderPublicView(searchTerm, categoryFilter, statusFilter);
});

// Category filter
document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
    const searchTerm = document.getElementById('searchInput')?.value || '';
    const categoryFilter = e.target.value;
    const statusFilter = document.getElementById('paymentStatusFilter')?.value || '';
    renderPublicView(searchTerm, categoryFilter, statusFilter);
});

// Payment status filter (Paid vs Pledged)
document.getElementById('paymentStatusFilter')?.addEventListener('change', (e) => {
    const searchTerm = document.getElementById('searchInput')?.value || '';
    const categoryFilter = document.getElementById('categoryFilter')?.value || '';
    const statusFilter = e.target.value;
    renderPublicView(searchTerm, categoryFilter, statusFilter);
});

// ==================== HIDDEN ADMIN TRIGGER ====================

function setupAdminTrigger() {
    const adminTrigger = document.getElementById('adminTrigger');
    if (adminTrigger) {
        // Single click as per user request
        adminTrigger.addEventListener('click', () => {
            if (!currentUser) {
                openModal('loginModal');
            } else {
                showAdminPanel();
            }
        });
    }

    // Check for admin route
    if (window.location.hash === '#admin' || window.location.pathname === '/admin') {
        openModal('loginModal');
    }
}

// Make functions global
window.downloadPDF = downloadPDF;
window.approveDonation = approveDonation;
window.renderPendingApprovals = renderPendingApprovals;

// ==================== COMMUNITY FEATURE ====================

let communityEnabled = false;

// Load community posts
async function loadCommunityPosts() {
    try {
        const posts = await apiGet('/api/community');
        renderCommunityPosts(posts);
    } catch (error) {
        console.error('Error loading community posts:', error);
    }
}

// Render community posts
function renderCommunityPosts(posts) {
    const container = document.getElementById('postsContainer');
    const countEl = document.getElementById('postCount');

    if (!container) return;

    countEl.textContent = `${posts.length} posts`;

    if (posts.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 2rem;">No posts yet. Be the first to share!</p>';
        return;
    }

    container.innerHTML = posts.map(post => `
        <div class="community-post glass-card" style="padding: 1.25rem; margin-bottom: 1rem; border-radius: var(--radius-md);">
            <div class="post-content" style="margin-bottom: 0.75rem; line-height: 1.6;">
                ${post.content}
            </div>
            <div class="post-meta" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
                📅 ${formatDate(post.createdAt)}
            </div>
            
            ${post.replies.length > 0 ? `
                <div class="post-replies" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                    <div style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.5rem;">💬 ${post.replies.length} replies</div>
                    ${post.replies.map(reply => `
                        <div class="reply-item" style="background: rgba(255, 255, 255, 0.02); padding: 0.75rem; border-radius: var(--radius-sm); margin-bottom: 0.5rem; border-left: 2px solid var(--primary-gold);">
                            <div style="font-size: 0.9rem; margin-bottom: 0.25rem;">${reply.content}</div>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">📅 ${formatDate(reply.createdAt)}</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            
            <div class="reply-form" style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--glass-border);">
                <form onsubmit="handleReplySubmit(event, '${post._id}')">
                    <div style="display: flex; gap: 0.5rem;">
                        <input type="text" placeholder="Add a reply..." maxlength="300" style="flex: 1; background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--glass-border); border-radius: var(--radius-sm); padding: 0.5rem;" required>
                        <button type="submit" class="btn btn-sm btn-primary">Reply</button>
                    </div>
                </form>
            </div>
        </div>
    `).join('');
}

// Handle post submission
document.getElementById('communityPostForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = document.getElementById('postContent').value.trim();

    if (!content) {
        showToast('Please enter some content', 'error');
        return;
    }

    try {
        await apiPost('/api/community', { content });
        document.getElementById('postContent').value = '';
        document.getElementById('charCount').textContent = '0/500';
        showToast('Post created successfully!', 'success');
        await loadCommunityPosts();
    } catch (error) {
        showToast(error.message || 'Failed to create post', 'error');
    }
});

// Character counter
document.getElementById('postContent')?.addEventListener('input', (e) => {
    const count = e.target.value.length;
    document.getElementById('charCount').textContent = `${count}/500`;
});

// Handle reply submission
window.handleReplySubmit = async function (event, postId) {
    event.preventDefault();
    const input = event.target.querySelector('input');
    const content = input.value.trim();

    if (!content) return;

    try {
        await apiPost(`/api/community/${postId}/reply`, { content });
        input.value = '';
        showToast('Reply added!', 'success');
        await loadCommunityPosts();
    } catch (error) {
        showToast(error.message || 'Failed to add reply', 'error');
    }
};

// Load community settings and toggle visibility
async function loadCommunitySettings() {
    try {
        const settings = await apiGet('/api/settings');
        communityEnabled = settings.communityEnabled || false;

        const section = document.getElementById('communitySection');
        if (section) {
            section.style.display = communityEnabled ? 'block' : 'none';
        }

        const toggle = document.getElementById('communityToggle');
        if (toggle) {
            toggle.checked = communityEnabled;
        }

        if (communityEnabled) {
            await loadCommunityPosts();
        }
    } catch (error) {
        console.error('Error loading community settings:', error);
    }
}

// Toggle community feature
window.toggleCommunity = async function () {
    const toggle = document.getElementById('communityToggle');
    const enabled = toggle.checked;

    try {
        await apiPut('/api/settings/community', { enabled });
        communityEnabled = enabled;

        const section = document.getElementById('communitySection');
        if (section) {
            section.style.display = enabled ? 'block' : 'none';
        }

        showToast(`Community ${enabled ? 'enabled' : 'disabled'}`, 'success');

        if (enabled) {
            await loadCommunityPosts();
        }
    } catch (error) {
        showToast('Failed to toggle community', 'error');
        toggle.checked = !enabled;
    }
};

// Load admin community posts (with IP logs)
async function loadAdminCommunityPosts() {
    try {
        const posts = await apiGet('/api/community/admin');
        renderAdminCommunityPosts(posts);
    } catch (error) {
        console.error('Error loading admin posts:', error);
    }
}

// Render admin community posts
function renderAdminCommunityPosts(posts) {
    const tbody = document.getElementById('communityPostsTableBody');
    if (!tbody) return;

    if (posts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem;">No posts yet</td></tr>';
        return;
    }

    tbody.innerHTML = posts.map(post => `
        <tr>
            <td style="max-width: 300px; word-wrap: break-word;">${post.content}</td>
            <td><code style="font-size: 0.75rem;">${post.ipAddress}</code><br><small>${formatDate(post.createdAt)}</small></td>
            <td>${post.replies.length}</td>
            <td>
                <button class="btn btn-sm btn-danger" onclick="deletePost('${post._id}')">🗑️ Delete</button>
            </td>
        </tr>
    `).join('');
}

// Delete post
window.deletePost = async function (id) {
    if (!confirm('Delete this post?')) return;

    try {
        await apiDelete(`/api/community/${id}`);
        showToast('Post deleted', 'success');
        await loadAdminCommunityPosts();
        await loadCommunityPosts();
    } catch (error) {
        showToast('Failed to delete post', 'error');
    }
};

// Initialize additional listeners
document.addEventListener('DOMContentLoaded', () => {
    setupAdminTrigger();
    handleSplash();
    loadCommunitySettings();
});
