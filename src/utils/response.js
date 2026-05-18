// ───────────────────────────────────────────────────────────────────
// Response Formatting Utilities
// ───────────────────────────────────────────────────────────────────
import { HTTP_STATUS } from '../constants';
export const sendSuccess = (c, data, status = HTTP_STATUS.OK) => {
    return c.json({
        success: true,
        data,
    }, status);
};
export const sendError = (c, message, status = HTTP_STATUS.INTERNAL_ERROR) => {
    return c.json({
        success: false,
        error: message,
    }, status);
};
export const sendPaginated = (c, data, total, page = 1, limit = 20, status = HTTP_STATUS.OK) => {
    const hasMore = (page - 1) * limit + data.length < total;
    return c.json({
        success: true,
        data: {
            items: data,
            pagination: {
                total,
                page,
                limit,
                hasMore,
                totalPages: Math.ceil(total / limit),
            },
        },
    }, status);
};
export const sendCreated = (c, data) => {
    return sendSuccess(c, data, HTTP_STATUS.CREATED);
};
export const sendNotFound = (c, resource = 'Resource') => {
    return sendError(c, `${resource} not found`, HTTP_STATUS.NOT_FOUND);
};
export const sendUnauthorized = (c) => {
    return sendError(c, 'Unauthorized', HTTP_STATUS.UNAUTHORIZED);
};
export const sendForbidden = (c) => {
    return sendError(c, 'Forbidden: Insufficient permissions', HTTP_STATUS.FORBIDDEN);
};
export const sendBadRequest = (c, message = 'Invalid request') => {
    return sendError(c, message, HTTP_STATUS.BAD_REQUEST);
};
