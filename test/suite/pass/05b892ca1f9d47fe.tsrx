function App({ kind }) @{
	@switch (kind) {
		@case 'a': {
			const t = <style>.a { color: red; }</style>;
			<><style apply={t} /><div /></>
		}
		@case 'b': {
			const t = <style>.b { color: blue; }</style>;
			<><style apply={t} /><div /></>
		}
	}
}