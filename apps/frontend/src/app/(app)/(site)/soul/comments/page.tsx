import { SoulComments } from '@gitroom/frontend/components/soul/comments/soul.comments';
export const dynamic = 'force-dynamic';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Postiz Comentários',
  description: 'Fila de comentários e respostas automáticas (soulpostiz)',
};

export default async function Index() {
  return <SoulComments />;
}
