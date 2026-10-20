import { useState } from 'react';
import { label } from './label';

export function App() @{
	const [count, setCount] = useState(0);

	<button aria-label={label} onClick={() => setCount(count + 1)}>
		{count}
	</button>
}
