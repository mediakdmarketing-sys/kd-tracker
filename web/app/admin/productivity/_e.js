const fs=require('fs');let s=fs.readFileSync('page.js','utf8');
const rep=(a,b)=>{a=a.replace(/\n/g,'\r\n');b=b.replace(/\n/g,'\r\n');if(!s.includes(a))throw new Error(a);s=s.replace(a,()=>b);};
rep("const [departments, data, apps, employeeList] = await Promise.all([\n    api('/api/admin/departments'),",
"const [savedDepartments, everyone, data, apps, employeeList] = await Promise.all([\n    api('/api/admin/departments'),\n    api('/api/admin/employees?status=active&limit=200'),");
rep("  const employees = employeeList.data;\n",
"  const employees = employeeList.data;\n  // Saved departments plus any an employee belongs to, so the filter lists every real department.\n  const departments = [...new Set([...savedDepartments, ...everyone.data.map((e) => e.department).filter(Boolean)])].sort(\n    (a, b) => a.localeCompare(b)\n  );\n");
fs.writeFileSync('page.js',s);
