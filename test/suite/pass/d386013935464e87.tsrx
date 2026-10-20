function App() { return <div>@{
			let [as_ref] = track(true);
			const props = { ref: input };
			<input {...(as_ref ? { ref: props.ref } : { input_ref: 'regular prop' })} />
		}</div>; }