import { config } from './config.ts';
import { db } from './db.ts';
import { createApp } from './app.ts';
import { recover, tick, cleanup } from './worker.ts';
if (!db.prepare('SELECT id FROM credentials WHERE id=1').get()) throw new Error('请先运行 npm run setup，并配置至少 12 位 ADMIN_PASSWORD。');
if (process.env.PAYMENT_MODE && process.env.PAYMENT_MODE !== 'mock') throw new Error('本版本仅支持 mock 测试支付，禁止配置为真实收款模式。');
let worker: ReturnType<typeof setInterval> | undefined, sweeper: ReturnType<typeof setInterval> | undefined;
const server = createApp().listen(config.port, config.host);
server.once('error', (error: NodeJS.ErrnoException) => {
  console.error(error.code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用，请先停止旧的打印服务。` : `启动失败：${error.message}`);
  process.exit(1);
});
server.once('listening', () => {
  recover();
  worker = setInterval(() => tick().catch(console.error), 700);
  sweeper = setInterval(() => cleanup().catch(console.error), 60_000);
  cleanup().catch(console.error);
  console.log(`纸间 API http://${config.host}:${config.port} · 测试支付 / PDF 输出模式`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(worker); clearInterval(sweeper); server.close(() => process.exit(0)); });
