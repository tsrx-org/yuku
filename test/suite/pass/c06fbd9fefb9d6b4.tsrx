function Declaration() { <div /> }
				const Arrow = () => { <div /> };
				const Expression = function () { <div /> };
				consume(function () { <div /> });
				const object = { render() { <div /> } };
				class Component { render() { <div /> } }