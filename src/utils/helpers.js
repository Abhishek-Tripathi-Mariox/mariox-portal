export function generateId(prefix = '') {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return prefix ? `${prefix}-${timestamp}-${random}` : `${timestamp}-${random}`;
}
export function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}
export function getCurrentDate() {
    return new Date().toISOString().split('T')[0];
}
export function getCurrentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
export function getMonthDateRange(yearMonth) {
    const [year, month] = yearMonth.split('-').map(Number);
    const start = `${yearMonth}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
}
export function calculateUtilizationColor(percent) {
    if (percent >= 100)
        return 'red';
    if (percent >= 70)
        return 'green';
    if (percent >= 50)
        return 'yellow';
    return 'gray';
}
export function calculateBurnRisk(consumedHours, allocatedHours, timelineProgress) {
    const hoursProgress = allocatedHours > 0 ? (consumedHours / allocatedHours) * 100 : 0;
    if (hoursProgress > 90)
        return 'critical';
    if (hoursProgress > timelineProgress * 1.2)
        return 'warning';
    return 'healthy';
}
export function paginate(data, page, limit) {
    const offset = (page - 1) * limit;
    const paginatedData = data.slice(offset, offset + limit);
    return {
        data: paginatedData,
        pagination: {
            page,
            limit,
            total: data.length,
            totalPages: Math.ceil(data.length / limit)
        }
    };
}
