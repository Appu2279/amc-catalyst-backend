import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import courseRoutes from './routes/course.routes.js';
import subjectRoutes from './routes/subject.routes.js';
import featureRoutes from './routes/feature.routes.js';
import questionRoutes from './routes/question.routes.js';
import adminMockTestRoutes from './routes/adminMockTest.routes.js';
import mockTestRoutes from './routes/mockTest.routes.js';
import attemptRoutes from './routes/attempt.routes.js';
import importBatchRoutes from './routes/importBatch.routes.js';
import bookmarkRoutes from './routes/bookmark.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import imageRoutes from './routes/image.routes.js';

const app = express();

// Comma-separated list of allowed origins, e.g.
//   CORS_ORIGIN=https://yourdomain.com,https://www.yourdomain.com
// Unset (local development) falls back to allowing everything.
const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins?.length ? allowedOrigins : '*',
  })
);

// Question imports post large payloads; everything else should not.
app.use('/api/admin/import-batches', express.json({ limit: '50mb' }));
app.use(express.json({ limit: '1mb' }));

// Liveness probe for the container healthcheck and, later, any load balancer.
// Deliberately does not touch the database: a slow query should not make the
// orchestrator kill a healthy process.
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api', featureRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/admin/mock-tests', adminMockTestRoutes);
app.use('/api/admin/import-batches', importBatchRoutes);
app.use('/api/mock-tests', mockTestRoutes);
app.use('/api/attempts', attemptRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/images',   imageRoutes);

export default app;