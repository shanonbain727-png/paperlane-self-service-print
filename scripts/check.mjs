import 'dotenv/config';
import { existsSync } from 'node:fs';
console.log('Node:', process.version);
console.log('后台密码:', process.env.ADMIN_PASSWORD?.length >= 12 ? '已配置' : '请先运行 npm run setup');
console.log('支付模式:', process.env.PAYMENT_MODE || 'mock');
console.log('字体:', existsSync('assets/NotoSansSC.ttf') ? '已配置' : '缺少 assets/NotoSansSC.ttf');
const paths = [process.env.SOFFICE_PATH, '.tools/lo-package/program/soffice.com', 'C:/Program Files/LibreOffice/program/soffice.com'].filter(Boolean);
console.log('Word 转换器:', paths.find(existsSync) || '未找到；配置 SOFFICE_PATH 后可转换 Word');
