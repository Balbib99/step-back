import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { createQueryClient } from './lib/queries';
import { Calendar } from './pages/Calendar';
import { Highlights, News, NotFound } from './pages/Placeholders';
import { Standings } from './pages/Standings';
import { Today } from './pages/Today';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Today />} />
        <Route path="calendario" element={<Calendar />} />
        <Route path="clasificacion" element={<Standings />} />
        <Route path="noticias" element={<News />} />
        <Route path="jugadas" element={<Highlights />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
