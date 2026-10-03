// Shared modules live outside mobile/, so resolve Babel runtime helpers from
// the same node_modules directory Metro uses for those modules.
module.exports = { modulePaths: ['<rootDir>/node_modules'] };
