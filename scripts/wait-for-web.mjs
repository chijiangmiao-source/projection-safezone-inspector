/**
 * verify 服务启动时等待 web 服务就绪（nginx 起来很快，但 depends_on 不保证端口可服务）。
 */
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const deadline = Date.now() + 60_000;

while (Date.now() < deadline) {
  try {
    const res = await fetch(base, { method: 'HEAD' });
    if (res.ok) {
      console.log(`web 服务已就绪：${base}`);
      process.exit(0);
    }
  } catch {
    // 尚未就绪，继续等待
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

console.error(`等待 ${base} 超时`);
process.exit(1);
