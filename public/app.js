let vulnerabilities = [];
let misconfigs = [];
let scriptEditor = null;
let confirmActionCallback = null;

function showConfirmModal(title, message, onConfirm) {
    document.getElementById('confirm-modal-title').innerText = title;
    document.getElementById('confirm-modal-message').innerText = message;
    
    document.getElementById('confirm-modal').classList.remove('hidden');
    setTimeout(() => {
        document.querySelector('#confirm-modal .neu-flat').classList.add('modal-enter-active');
    }, 10);
    
    confirmActionCallback = onConfirm;
}

function closeConfirmModal() {
    const modalContent = document.querySelector('#confirm-modal .neu-flat');
    if (modalContent) modalContent.classList.remove('modal-enter-active');
    setTimeout(() => {
        document.getElementById('confirm-modal').classList.add('hidden');
        confirmActionCallback = null;
    }, 300);
}

function initEditor() {
    if (!scriptEditor) {
        scriptEditor = CodeMirror.fromTextArea(document.getElementById('misconfig-script'), {
            mode: 'shell',
            theme: 'ayu-dark',
            lineNumbers: true,
            lineWrapping: true
        });
        
        document.getElementById('misconfig-type').addEventListener('change', (e) => {
            if (scriptEditor) {
                scriptEditor.setOption("mode", e.target.value === 'powershell' ? 'powershell' : 'shell');
            }
        });
    }
}

async function fetchData() {
    try {
        const [vulnsRes, misconfigsRes] = await Promise.all([
            fetch('/api/vulns'),
            fetch('/api/misconfigs')
        ]);
        vulnerabilities = await vulnsRes.json();
        misconfigs = await misconfigsRes.json();
        render();
    } catch (err) {
        console.error('Error fetching data:', err);
        alert('Failed to fetch data from the server.');
    }
}

function render() {
    const list = document.getElementById('vuln-list');
    const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
    const filterPlatform = document.getElementById('filter-platform')?.value || '';
    const filterTarget = document.getElementById('filter-target')?.value || '';

    list.innerHTML = '';
    
    let filteredVulns = vulnerabilities.filter(vuln => {
        const matchesSearch = vuln.name.toLowerCase().includes(searchTerm);
        const matchesPlatform = filterPlatform === '' || vuln.platform === filterPlatform;
        const matchesTarget = filterTarget === '' || vuln.target === filterTarget;
        return matchesSearch && matchesPlatform && matchesTarget;
    });
    
    if (filteredVulns.length === 0) {
        list.innerHTML = '<div class="col-span-full text-center text-[#8b91a3] py-12 neu-pressed rounded-3xl mx-4">No vulnerabilities found matching your criteria.</div>';
        return;
    }
    
    filteredVulns.forEach(vuln => {
        const vulnMisconfigs = misconfigs.filter(m => m.vuln_id === vuln.id);
        
        const card = document.createElement('div');
        card.className = 'neu-flat rounded-[2rem] p-8 flex flex-col relative overflow-hidden group';
        
        card.innerHTML = `
            <div class="flex justify-between items-start mb-6 relative z-10">
                <div>
                    <h3 class="text-2xl font-bold text-white mb-3 tracking-wide">${vuln.name}</h3>
                    <div class="flex gap-3">
                        <span class="px-4 py-1.5 rounded-xl text-xs font-bold text-glow-pink neu-pressed uppercase tracking-wider">${vuln.target}: ${vuln.platform}</span>
                    </div>
                </div>
                <div class="flex gap-3">
                    <button onclick='editVuln(${JSON.stringify(vuln).replace(/'/g, "&apos;")})' class="p-3 neu-btn rounded-xl transition text-glow-cyan" title="Edit Vulnerability">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </button>
                    <button onclick='deleteVuln(${vuln.id})' class="p-3 neu-btn rounded-xl transition text-[#ec4899]" title="Delete Vulnerability" style="text-shadow: 0 0 10px rgba(236,72,153,0.4)">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </div>

            <div class="mt-2 flex-1 relative z-10 flex flex-col">
                <div class="flex items-center justify-between pb-4 mb-4 border-b border-[#2e3238]">
                    <h4 class="text-sm font-bold text-[#A0A5B5] uppercase tracking-wider flex items-center gap-3">
                        Misconfigurations 
                        <span class="neu-pressed px-3 py-1 rounded-lg text-glow-cyan font-bold">${vulnMisconfigs.length}</span>
                    </h4>
                    <button onclick="openMisconfigModal(${vuln.id})" class="text-xs neu-btn px-4 py-2 rounded-xl text-glow-cyan font-bold uppercase tracking-wide flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>
                        Add
                    </button>
                </div>
                <div class="space-y-5 mt-2 flex-1 overflow-y-auto pr-4 custom-scrollbar max-h-64">
                    ${vulnMisconfigs.map(m => `
                        <div class="neu-pressed rounded-2xl p-5 group/item relative">
                            <div class="flex justify-between items-center mb-4">
                                <span class="text-xs font-mono text-glow-cyan uppercase font-bold tracking-wider">${m.type}</span>
                                <span class="text-xs text-[#A0A5B5] flex items-center gap-2 uppercase tracking-wider font-bold">
                                    <svg class="w-4 h-4 text-[#8b91a3]" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clip-rule="evenodd" /></svg>
                                    ${m.run_as}
                                </span>
                            </div>
                            <pre class="text-sm font-mono text-[#E2E8F0] bg-[#1a1c20] p-4 rounded-xl overflow-x-auto shadow-inner leading-relaxed"><code class="language-${m.type === 'powershell' ? 'powershell' : m.type === 'bash' ? 'bash' : 'dos'}">${m.script.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>
                            
                            <div class="absolute top-4 right-4 opacity-0 group-hover/item:opacity-100 transition-opacity flex gap-2">
                                <button type="button" class="edit-misconfig-btn p-2 neu-btn rounded-lg text-glow-cyan" title="Edit" data-misconfig='${JSON.stringify(m).replace(/'/g, "&apos;")}'>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                                <button type="button" class="delete-misconfig-btn p-2 neu-btn rounded-lg text-[#ec4899]" title="Delete" data-id="${m.id}" style="text-shadow: 0 0 10px rgba(236,72,153,0.4)">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                    ${vulnMisconfigs.length === 0 ? `
                        <div class="flex flex-col items-center justify-center h-full text-[#8b91a3] py-8 neu-pressed rounded-2xl">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <span class="text-xs uppercase tracking-widest font-bold opacity-60">No configs yet</span>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
    
    // Apply syntax highlighting
    document.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
}

// Vuln Modal Logic
function openVulnModal(vuln = null) {
    document.getElementById('vuln-modal').classList.remove('hidden');
    setTimeout(() => {
        document.querySelector('#vuln-modal .neu-flat').classList.add('modal-enter-active');
    }, 10);
    
    if (vuln) {
        document.getElementById('vuln-modal-title').innerText = 'Edit Vulnerability';
        document.getElementById('vuln-id').value = vuln.id;
        document.getElementById('vuln-name').value = vuln.name;
        document.getElementById('vuln-platform').value = vuln.platform;
        document.getElementById('vuln-target').value = vuln.target;
    } else {
        document.getElementById('vuln-modal-title').innerText = 'Add Vulnerability';
        document.getElementById('vuln-form').reset();
        document.getElementById('vuln-id').value = '';
    }
}

function closeVulnModal() {
    document.querySelector('#vuln-modal .neu-flat').classList.remove('modal-enter-active');
    setTimeout(() => {
        document.getElementById('vuln-modal').classList.add('hidden');
    }, 300);
}

async function saveVuln(e) {
    e.preventDefault();
    const id = document.getElementById('vuln-id').value;
    const data = {
        name: document.getElementById('vuln-name').value,
        platform: document.getElementById('vuln-platform').value,
        target: document.getElementById('vuln-target').value
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? '/api/vulns/' + id : '/api/vulns';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Server error');
        closeVulnModal();
        fetchData();
    } catch(err) {
        alert('Error saving vulnerability');
        console.error(err);
    }
}

function editVuln(vuln) {
    openVulnModal(vuln);
}

function deleteVuln(id) {
    showConfirmModal(
        'Delete Vulnerability',
        'Are you sure you want to delete this vulnerability? All associated misconfigurations will also be deleted.',
        async () => {
            try {
                const res = await fetch('/api/vulns/' + id, { method: 'DELETE' });
                if (!res.ok) throw new Error('Server error');
                fetchData();
            } catch(err) {
                alert('Error deleting');
                console.error(err);
            }
        }
    );
}

// Misconfig Modal Logic
function openMisconfigModal(vulnId, misconfig = null) {
    document.getElementById('misconfig-modal').classList.remove('hidden');
    setTimeout(() => {
        document.querySelector('#misconfig-modal .neu-flat').classList.add('modal-enter-active');
    }, 10);
    
    document.getElementById('misconfig-vuln-id').value = vulnId;
    
    initEditor();
    
    if (misconfig) {
        document.getElementById('misconfig-modal-title').innerText = 'Edit Misconfig';
        document.getElementById('misconfig-id').value = misconfig.id;
        document.getElementById('misconfig-type').value = misconfig.type;
        document.getElementById('misconfig-run-as').value = misconfig.run_as;
        scriptEditor.setValue(misconfig.script);
        scriptEditor.setOption("mode", misconfig.type === 'powershell' ? 'powershell' : 'shell');
    } else {
        document.getElementById('misconfig-modal-title').innerText = 'Add Misconfig';
        document.getElementById('misconfig-form').reset();
        document.getElementById('misconfig-id').value = '';
        scriptEditor.setValue('');
    }
    
    setTimeout(() => scriptEditor.refresh(), 50);
}

function closeMisconfigModal() {
    document.querySelector('#misconfig-modal .neu-flat').classList.remove('modal-enter-active');
    setTimeout(() => {
        document.getElementById('misconfig-modal').classList.add('hidden');
    }, 300);
}

async function saveMisconfig(e) {
    e.preventDefault();
    const scriptContent = scriptEditor.getValue().trim();
    if (!scriptContent) {
        alert("Script content cannot be empty.");
        return;
    }
    
    const id = document.getElementById('misconfig-id').value;
    const data = {
        vuln_id: document.getElementById('misconfig-vuln-id').value,
        type: document.getElementById('misconfig-type').value,
        run_as: document.getElementById('misconfig-run-as').value,
        script: scriptContent
    };
    
    const method = id ? 'PUT' : 'POST';
    const url = id ? '/api/misconfigs/' + id : '/api/misconfigs';
    
    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Server error');
        closeMisconfigModal();
        fetchData();
    } catch(err) {
        alert('Error saving misconfig');
        console.error(err);
    }
}

function editMisconfig(m) {
    openMisconfigModal(m.vuln_id, m);
}

function deleteMisconfig(id) {
    showConfirmModal(
        'Delete Misconfig',
        'Are you sure you want to delete this misconfig?',
        async () => {
            try {
                const res = await fetch('/api/misconfigs/' + id, { method: 'DELETE' });
                if (!res.ok) throw new Error('Server error');
                fetchData();
            } catch(err) {
                alert('Error deleting');
                console.error(err);
            }
        }
    );
}

// Event listeners for search, filters, and delegated clicks
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('search-input')?.addEventListener('input', render);
    document.getElementById('filter-platform')?.addEventListener('change', render);
    document.getElementById('filter-target')?.addEventListener('change', render);
    
    document.getElementById('confirm-modal-btn')?.addEventListener('click', () => {
        if (confirmActionCallback) {
            confirmActionCallback();
        }
        closeConfirmModal();
    });
    
    // Delegated click listeners for dynamically rendered misconfig buttons
    document.body.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-misconfig-btn');
        if (deleteBtn) {
            e.preventDefault();
            deleteMisconfig(deleteBtn.dataset.id);
            return;
        }
        
        const editBtn = e.target.closest('.edit-misconfig-btn');
        if (editBtn) {
            e.preventDefault();
            const misconfigData = JSON.parse(editBtn.dataset.misconfig);
            editMisconfig(misconfigData);
            return;
        }
    });
});

// Initial fetch
fetchData();
