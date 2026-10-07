import { EmptyState, PageHeader } from '../components/PageHeader';

// Each screen below is replaced by its real version in its own task (T10, T15, T19, T22).

export function Calendar() {
  return (
    <>
      <PageHeader title="Calendario" />
      <EmptyState>Aquí aparecerán los partidos de pretemporada y temporada, día a día.</EmptyState>
    </>
  );
}

export function Standings() {
  return (
    <>
      <PageHeader title="Clasificación" />
      <EmptyState>Aquí aparecerá la clasificación del Este y del Oeste.</EmptyState>
    </>
  );
}

export function News() {
  return (
    <>
      <PageHeader title="Noticias" />
      <EmptyState>Aquí aparecerán las noticias, con su imagen o vídeo.</EmptyState>
    </>
  );
}

export function Highlights() {
  return (
    <>
      <PageHeader title="Jugadas" />
      <EmptyState>Aquí aparecerán las mejores jugadas de cada partido.</EmptyState>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Página no encontrada" />
      <EmptyState>Esa dirección no existe. Usa la barra de abajo para volver.</EmptyState>
    </>
  );
}
