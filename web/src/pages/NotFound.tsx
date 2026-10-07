import { EmptyState, PageHeader } from '../components/PageHeader';

export function NotFound() {
  return (
    <>
      <PageHeader title="Página no encontrada" />
      <EmptyState>Esa dirección no existe. Usa la barra de abajo para volver.</EmptyState>
    </>
  );
}
