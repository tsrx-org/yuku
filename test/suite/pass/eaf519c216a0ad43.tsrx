function App() { return <div>@{
			let [enabled] = track(true);
			<button {...(enabled ? { onClick: fn } : { title: 'disabled' })}>target</button>
		}</div>; }