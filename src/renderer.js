import { jsx as _jsx, jsxs as _jsxs } from "hono/jsx/jsx-runtime";
import { jsxRenderer } from 'hono/jsx-renderer';
export const renderer = jsxRenderer(({ children }) => {
    return (_jsxs("html", { children: [_jsxs("head", { children: [_jsx("meta", { charSet: "UTF-8" }), _jsx("meta", { name: "viewport", content: "width=device-width, initial-scale=1.0" }), _jsx("meta", { name: "theme-color", content: "#1A0E08" }), _jsx("title", { children: "Mariox Software" }), _jsx("link", { rel: "icon", type: "image/jpeg", href: "/static/images/mariox-logo.jpg" }), _jsx("link", { rel: "shortcut icon", type: "image/jpeg", href: "/static/images/mariox-logo.jpg" }), _jsx("link", { rel: "apple-touch-icon", href: "/static/images/mariox-logo.jpg" }), _jsx("link", { href: "/static/style.css", rel: "stylesheet" })] }), _jsx("body", { children: children })] }));
});
