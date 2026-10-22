/** @type {import('next').NextConfig} */
const backendOrigin = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_BASE_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : null);

if (!backendOrigin && process.env.NODE_ENV === 'production') {
  throw new Error('Set BACKEND_URL to the deployed FastAPI origin before building the frontend.');
}

if (backendOrigin) {
  const parsedBackendOrigin = new URL(backendOrigin);
  if (parsedBackendOrigin.pathname !== '/' || parsedBackendOrigin.search || parsedBackendOrigin.hash) {
    throw new Error('BACKEND_URL must be an origin only, for example https://your-api.vercel.app.');
  }
  const localBackend = ['localhost', '127.0.0.1', '[::1]'].includes(parsedBackendOrigin.hostname);
  if (process.env.NODE_ENV === 'production' && process.env.BACKEND_URL && parsedBackendOrigin.protocol !== 'https:' && !localBackend) {
    throw new Error('BACKEND_URL must use HTTPS in production.');
  }
}

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['leaflet', 'react-leaflet'],
  async rewrites() {
    if (!backendOrigin) return [];
    return [{ source: '/api/:path*', destination: `${backendOrigin.replace(/\/$/, '')}/api/:path*` }];
  },
};

export default nextConfig;
