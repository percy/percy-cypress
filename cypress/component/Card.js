import { createElement as h, useState } from 'react';

export default function Card({ title }) {
  const [count, setCount] = useState(0);
  return h('div', { className: 'card', style: { width: 240, border: '2px solid #c00', padding: 8 } },
    h('h2', null, title),
    h('button', { onClick: () => setCount(count + 1) }, 'Click'),
    h('span', { className: 'count' }, String(count))
  );
}
