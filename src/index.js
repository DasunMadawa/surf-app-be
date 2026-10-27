import './env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { load } from './db.js';
import publicRoutes from './routes/public.js';
import partnerRoutes from './routes/partner.js';
import adminRoutes from './routes/admin.js';

await load();

const app = express();

// CORS: allow specific origins from env, or all origins if not set.
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin
    ? corsOrigin.split(',').map(o => o.trim())
    : '*',
}));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api', publicRoutes);
app.use('/api', partnerRoutes);
app.use('/api', adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` }));

// In production, serve the built React app from the same origin.
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message, details: err.details });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`Stara middleware listening on http://localhost:${PORT}`);
});
