import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{proxy:{'/api':'http://127.0.0.1:8000'}},build:{rollupOptions:{output:{manualChunks(id){
  if(id.includes('/node_modules/@xyflow/'))return 'routing-visuals';
  if(id.includes('/node_modules/recharts/'))return 'charts';
  if(id.includes('/node_modules/motion/')||id.includes('/node_modules/framer-motion/')||id.includes('/node_modules/motion-dom/')||id.includes('/node_modules/motion-utils/'))return 'motion';
  if(/\/src\/i18n\/(catalog-|extra-catalog|sources\.json|extra-sources\.json|bindCatalog|presentation-catalog|core)/.test(id))return 'locale-resources';
  if(id.includes('/node_modules/'))return 'vendor';
}}}},test:{environment:'jsdom',setupFiles:'./src/test/setup.ts',css:true,globals:true,exclude:['e2e/**','node_modules/**','**/.pytest_cache/**']}});
