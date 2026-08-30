// 飞书仪表盘插件 hooks：主题跟随 + 配置读写（照 dashboard-page-preview 参考项目的已验证模式）

import { useLayoutEffect, useState } from 'react';
import { dashboard, DashboardState } from '@lark-base-open/js-sdk';

/** 跟随飞书主题色（classis dashboard form 用） */
export function useTheme() {
  const [bgColor, setBgColor] = useState('#ffffff');
  const [theme, setTheme] = useState<string>('light');

  useLayoutEffect(() => {
    dashboard.getTheme().then((res: any) => {
      setBgColor(res.chartBgColor || '#ffffff');
      setTheme((res.theme || 'light').toLowerCase());
      document.body.setAttribute('theme-mode', (res.theme || 'light').toLowerCase());
    });

    dashboard.onThemeChange((res: any) => {
      setBgColor(res?.data?.chartBgColor || '#ffffff');
      setTheme((res?.data?.theme || 'light').toLowerCase());
      document.body.setAttribute('theme-mode', (res?.data?.theme || 'light').toLowerCase());
    });
  }, []);

  return { bgColor, theme };
}

/** 初始化 + 监听配置变化（返回当前配置 + 更新函数） */
export function useConfig<T>(defaultConfig: T) {
  const [config, setConfig] = useState<T>(defaultConfig);
  const isCreate = dashboard.state === DashboardState.Create;
  const isConfig = dashboard.state === DashboardState.Config || isCreate;

  useLayoutEffect(() => {
    if (isCreate) return;
    dashboard.getConfig().then((res: any) => {
      const customConfig = res?.customConfig as T | undefined;
      if (customConfig) setConfig(customConfig);
      // 配置加载完成后通知服务端可渲染（预留渲染时间）
    });
  }, [isCreate]);

  useLayoutEffect(() => {
    const off = dashboard.onConfigChange((r: any) => {
      const customConfig = r?.data?.customConfig as T | undefined;
      if (customConfig) setConfig(customConfig);
    });
    return () => { off?.(); };
  }, []);

  /** 保存配置 */
  const saveConfig = (customConfig: T) => {
    dashboard.saveConfig({ customConfig, dataConditions: [] } as any);
  };

  /** 通知服务端渲染完成（可截图） */
  const setRendered = (delayMs = 2500) => {
    setTimeout(() => dashboard.setRendered(), delayMs);
  };

  return { config, setConfig, saveConfig, setRendered, isCreate, isConfig };
}
