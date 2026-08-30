// 飞书仪表盘插件入口
import React from 'react';
import { createRoot } from 'react-dom/client';
import FeishuPluginApp from './FeishuPluginApp';
// 飞书仪表盘插件需要 SDK 的 dashboard 样式（参考项目必需）
import '@lark-base-open/js-sdk/dist/style/dashboard.css';
import './plugin.css';

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <FeishuPluginApp />
    </React.StrictMode>
  );
}
