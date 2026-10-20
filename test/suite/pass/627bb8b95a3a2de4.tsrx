export function App({ ok }: any) {
	return (
		<Host
			slot={
				<button>
					{ok ? <X /> : <Y />}
				</button>
			}
			onChange={(d: any) => go(d)}
		/>
	);
}