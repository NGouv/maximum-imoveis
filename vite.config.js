import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        login: resolve(process.cwd(), "admin/login.html"),
        dashboard: resolve(process.cwd(), "admin/dashboard.html"),
        properties: resolve(process.cwd(), "admin/imoveis.html"),
        settings: resolve(process.cwd(), "admin/configuracoes.html"),
        adminRoot: resolve(process.cwd(), "admin/index.html"),
        loginAlias: resolve(process.cwd(), "admin/login/index.html"),
        dashboardAlias: resolve(process.cwd(), "admin/dashboard/index.html"),
        propertiesAlias: resolve(process.cwd(), "admin/imoveis/index.html"),
        settingsAlias: resolve(process.cwd(), "admin/configuracoes/index.html")
      }
    }
  }
});
