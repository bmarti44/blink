const micromatch = require('micromatch');
const { ESLint } = require('eslint');

module.exports = async (filesPaths) => {
  const commands = [];
  const eslint = new ESLint();

  const pretierFilesPaths = micromatch(filesPaths, ['**/*.{js,json,css,md,ts,tsx,html}']);
  const eslintFilesPaths = (
    await Promise.all(micromatch(filesPaths, ['**/*.{js,ts,tsx}']).map(async (filePath) => !(await eslint.isPathIgnored(filePath)) && filePath))
  ).filter(Boolean);

  if (pretierFilesPaths.length) {
    commands.push(`npm run format:files -- ${pretierFilesPaths.join(' ')}`);
  }
  if (eslintFilesPaths.length) {
    commands.push(`npm run lint:fix -- ${eslintFilesPaths.join(' ')}`);
  }

  return commands;
};
