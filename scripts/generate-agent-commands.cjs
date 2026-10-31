const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const file = path.join(root, 'src/shared/coreProtocol.ts')
const program = ts.createProgram([file], {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true,
  allowImportingTsExtensions: true, noEmit: true
})
const checker = program.getTypeChecker(), source = program.getSourceFile(file)
const exportsMap = new Map(checker.getExportsOfModule(checker.getSymbolAtLocation(source)).map(s => [s.name, s]))
let registry
ts.forEachChild(source, node => {
  if (!ts.isVariableStatement(node)) return
  for (const declaration of node.declarationList.declarations)
    if (declaration.name.getText(source) === 'OPERATIONS') registry = declaration.initializer
})
const interactive = /(?:choose|pick|importDraft|exportDraft|restoreFrom|selectFiles)/i
const nativeDialogs = new Set(['backup.export','backup.preview','imports.previewFile','audio.dsp.import','audio.dsp.export','themes.import','themes.export','themes.importAsset','extensions.export','ncm.cloud.download','study.export','plugins.install'])
function schema(type, depth = 0, ancestors = new Set()) {
  if (!type) return {}
  const flags = type.flags
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {}
  if (flags & ts.TypeFlags.Never) return false
  if (flags & ts.TypeFlags.StringLiteral) return { type: 'string', const: type.value }
  if (flags & ts.TypeFlags.NumberLiteral) return { type: 'number', const: type.value }
  if (flags & ts.TypeFlags.BooleanLiteral) return { type: 'boolean', const: type.intrinsicName === 'true' }
  if (flags & ts.TypeFlags.String) return { type: 'string' }
  if (flags & ts.TypeFlags.Number) return { type: 'number' }
  if (flags & ts.TypeFlags.Boolean) return { type: 'boolean' }
  if (flags & ts.TypeFlags.Null) return { type: 'null' }
  if (type.isUnion()) {
    const types = type.types.filter(t => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)))
    return types.length === 1 ? schema(types[0], depth, ancestors) : { anyOf: types.map(t => schema(t, depth, ancestors)) }
  }
  if (depth > 7 || ancestors.has(type)) return { description: checker.typeToString(type).slice(0, 1000) }
  const seen = new Set(ancestors); seen.add(type)
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const items = checker.getIndexTypeOfType(type, ts.IndexKind.Number)
    return { type: 'array', items: schema(items, depth + 1, seen) }
  }
  const properties = {}, required = []
  for (const property of type.getProperties()) {
    const declaration = property.valueDeclaration || property.declarations?.[0] || source
    properties[property.name] = schema(checker.getTypeOfSymbolAtLocation(property, declaration), depth + 1, seen)
    const documentation = ts.displayPartsToString(property.getDocumentationComment(checker))
    if (documentation && typeof properties[property.name] === 'object') properties[property.name].description = documentation
    if (!(property.flags & ts.SymbolFlags.Optional)) required.push(property.name)
  }
  const index = checker.getIndexTypeOfType(type, ts.IndexKind.String)
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: index ? schema(index, depth + 1, seen) : false }
}
const commandType = checker.getDeclaredTypeOfSymbol(exportsMap.get('CoreCommands'))
const queryType = checker.getDeclaredTypeOfSymbol(exportsMap.get('CoreQueries'))
const operations = registry.properties.map(node => {
  const name = node.name.text
  const meta = Object.fromEntries(node.initializer.properties.map(p => [p.name.getText(source), p.initializer.text]))
  const property = (meta.kind === 'command' ? commandType : queryType).getProperty(name)
  if (!property) throw Error('Missing protocol type: ' + name)
  let input = checker.getTypeOfSymbolAtLocation(property, property.valueDeclaration || property.declarations[0])
  let output
  if (meta.kind === 'query') {
    const outputProperty = input.getProperty('output')
    output = checker.getTypeOfSymbolAtLocation(outputProperty, outputProperty.valueDeclaration || outputProperty.declarations[0])
    const inputProperty = input.getProperty('input')
    input = checker.getTypeOfSymbolAtLocation(inputProperty, inputProperty.valueDeclaration || inputProperty.declarations[0])
  }
  return { name, domain: name.split('.')[0], ...meta, interactive: interactive.test(name) || nativeDialogs.has(name),
    inputSchema: schema(input), inputType: checker.typeToString(input, undefined, ts.TypeFormatFlags.NoTruncation).slice(0, 6000),
    ...(output ? { outputType: checker.typeToString(output).slice(0, 2000) } : {}) }
}).sort((a,b) => a.name.localeCompare(b.name))
const data = { protocolVersion: 1, software: 'TwilightEcho', operations }
const json = JSON.stringify(data, null, 2) + '\n'
for (const destination of ['resources/agent-cli/commands.json', 'agent-harness/cli_anything/twilightecho/commands.json']) {
  const target = path.join(root, destination)
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== json) throw Error('Agent manifest is stale: ' + destination)
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, json)
  }
}
console.log(JSON.stringify({ operations: operations.length, domains: [...new Set(operations.map(o=>o.domain))], bytes: Buffer.byteLength(json) }))
