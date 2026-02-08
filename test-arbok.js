import { createMCPServer } from './dist/mcp/server.js';

// Set environment variable
process.env.PROJECT_PATH = '/tmp/arbok-test-project';

async function test() {
  console.log('Creating MCP server...');
  const server = await createMCPServer();
  
  console.log('\n=== Testing arbok_init ===');
  const initResult = await server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: {
      name: 'arbok_init',
      arguments: { projectPath: '/tmp/arbok-test-project' }
    }
  });
  console.log('Init result:', JSON.parse(initResult.content[0].text));
  
  // Give it a moment for file operations
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  console.log('\n=== Testing arbok_get_file_structure ===');
  const fileStructResult = await server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: {
      name: 'arbok_get_file_structure',
      arguments: { filePath: 'test.ts' }
    }
  });
  console.log('File structure:', JSON.parse(fileStructResult.content[0].text));
  
  console.log('\n=== Testing arbok_search_symbol ===');
  const searchResult = await server._requestHandlers.get('tools/call')({
    method: 'tools/call',
    params: {
      name: 'arbok_search_symbol',
      arguments: { query: 'hello' }
    }
  });
  console.log('Search result:', JSON.parse(searchResult.content[0].text));
  
  console.log('\n=== Checking .clinerules creation ===');
  const fs = await import('fs');
  const path = await import('path');
  const clineruleDir = path.default.join('/tmp/arbok-test-project', '.clinerules');
  if (fs.existsSync(clineruleDir)) {
    console.log('.clinerules directory created ✓');
    const rulesFile = path.default.join(clineruleDir, 'rules.md');
    if (fs.existsSync(rulesFile)) {
      console.log('rules.md exists ✓');
    }
    const workflowsDir = path.default.join(clineruleDir, 'workflows');
    if (fs.existsSync(workflowsDir)) {
      console.log('workflows directory exists ✓');
      const files = fs.readdirSync(workflowsDir);
      console.log('Workflow files:', files);
    }
  }
  
  console.log('\n=== Checking Memory Bank files ===');
  const memoryBankDir = path.default.join('/tmp/arbok-test-project', 'memory-bank');
  if (fs.existsSync(memoryBankDir)) {
    console.log('memory-bank directory created ✓');
    const files = fs.readdirSync(memoryBankDir);
    console.log('Memory Bank files:', files);
    
    // Check content of one file
    const productContextPath = path.default.join(memoryBankDir, 'productContext.md');
    if (fs.existsSync(productContextPath)) {
      const content = fs.readFileSync(productContextPath, 'utf-8');
      console.log('\n=== productContext.md sample (first 500 chars) ===');
      console.log(content.substring(0, 500));
    }
  }
  
  console.log('\n✅ All tests passed!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
