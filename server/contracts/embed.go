// Package contracts contains the reviewed portable-fact allowlist shared with TypeScript.
package contracts

import _ "embed"

//go:embed entities.json
var Entities []byte
