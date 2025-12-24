const supabaseUrl = 'https://nhpfgtmqpslmiywyowtn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ocGZndG1xcHNsbWl5d3lvd3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1NDA4NjgsImV4cCI6MjA4MTExNjg2OH0.o1YimirJA75cFLe4OTeNzX8gU1LPwJRbQOO8IGFwHdU';

const client = supabase.createClient(supabaseUrl, supabaseKey);

let user = null;
let localFiles = new Map();
let currentId = null;
let isSignup = false;
let isSharedView = false; // Tracks if we are viewing a shared link

const el = id => document.getElementById(id);

const setView = id => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    el(id).classList.add('active');
};

const showToast = (msg, isError = false) => {
    const t = el('toast');
    t.innerText = msg;
    t.style.backgroundColor = isError ? "var(--error)" : "var(--bg-panel)";
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 4000);
};

// Initialize Auth and Shared Link Check
async function init() {
    try {
        // 1. Check if this is a shared link first
        const params = new URLSearchParams(window.location.search);
        const sharedProjectId = params.get('p');

        if (sharedProjectId) {
            isSharedView = true;
            loadSharedProject(sharedProjectId);
            return; // Don't proceed to auth if viewing a shared project
        }

        // 2. Normal Auth Flow
        const { data: { session }, error } = await client.auth.getSession();
        if (error) throw error;
        handleAuthState(session?.user || null);
        client.auth.onAuthStateChange((_event, session) => {
            // Only update auth state if we aren't in a shared view
            if (!isSharedView) handleAuthState(session?.user || null);
        });
    } catch (err) {
        console.error(err);
        showToast("Initialization Failed", true);
    }
}

// Fetch a project for shared link (No Auth Required for public access if policies allow)
async function loadSharedProject(id) {
    el('loading-text').innerText = "Loading Shared Project...";
    const { data, error } = await client.from('projects').select('*').eq('id', id).single();
    
    if (error || !data) {
        showToast("Project not found or private", true);
        setTimeout(() => window.location.href = window.location.origin + window.location.pathname, 2000);
        return;
    }

    // Hide the header for shared links to make it feel like a real website
    el('preview-header').style.display = 'none';
    runPreview(data.html, data.css, data.js);
}

function handleAuthState(u) {
    user = u;
    if (user) {
        el('user-display').innerText = user.email;
        fetchProjects();
        setView('view-dashboard');
    } else {
        setView('view-auth');
    }
}

// Authentication Listeners
el('btn-auth-main').onclick = async () => {
    const email = el('auth-email').value;
    const password = el('auth-password').value;
    if(!email || !password) return showToast("Enter credentials", true);
    const { error } = isSignup ? await client.auth.signUp({ email, password }) : await client.auth.signInWithPassword({ email, password });
    if(error) showToast(error.message, true);
    else if(isSignup) showToast("Check email for confirmation");
};

el('btn-auth-toggle').onclick = () => {
    isSignup = !isSignup;
    el('auth-title').innerText = isSignup ? "Create Account" : "Welcome";
    el('btn-auth-main').innerText = isSignup ? "Sign Up" : "Log In";
    el('btn-auth-toggle').innerText = isSignup ? "Login instead" : "Sign Up instead";
};

el('btn-logout').onclick = () => client.auth.signOut();

// CRUD Operations
async function fetchProjects() {
    if (!user) return;
    const { data, error } = await client.from('projects').select('*').order('updated_at', { ascending: false });
    if(error) return showToast(error.message, true);

    const grid = el('project-grid-container');
    grid.innerHTML = data.length ? '' : '<p style="color:var(--text-dim); padding:20px;">No projects found.</p>';

    data.forEach(p => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = `
            <h3>${p.name}</h3>
            <p style="font-size:0.75rem; color:var(--text-dim);">Updated: ${new Date(p.updated_at).toLocaleDateString()}</p>
            <div style="display:flex; flex-wrap: wrap; gap:8px; margin-top: auto;">
                <button class="btn-base btn-primary btn-p-run" style="flex:1">Run</button>
                <button class="btn-base btn-secondary btn-p-edit" style="flex:1">Edit</button>
                <button class="btn-base btn-success btn-p-share" style="width:100%">🔗 Share Link</button>
                <button class="btn-base btn-danger btn-p-del" style="width:100%">Delete</button>
            </div>
        `;
        
        card.querySelector('.btn-p-run').onclick = () => {
            el('preview-header').style.display = 'flex'; // Show header for internal preview
            runPreview(p.html, p.css, p.js);
        };

        card.querySelector('.btn-p-edit').onclick = () => {
            currentId = p.id;
            el('edit-html').value = p.html || ''; 
            el('edit-css').value = p.css || ''; 
            el('edit-js').value = p.js || '';
            setView('view-editor');
        };

        card.querySelector('.btn-p-share').onclick = () => {
            const shareUrl = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
            copyToClipboard(shareUrl);
        };

        card.querySelector('.btn-p-del').onclick = async () => {
            if(confirm("Delete project?")) {
                await client.from('projects').delete().eq('id', p.id);
                fetchProjects();
                showToast("Deleted");
            }
        };
        grid.appendChild(card);
    });
}

function copyToClipboard(text) {
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast("Link copied to clipboard!");
}

el('btn-final-save').onclick = async () => {
    const name = el('project-name-input').value;
    if(!name) return showToast("Enter name", true);
    const { error } = await client.from('projects').insert([{
        user_id: user.id, name,
        html: localFiles.get('html') || '',
        css: localFiles.get('css') || '',
        js: localFiles.get('js') || ''
    }]);
    if(error) showToast(error.message, true);
    else {
        el('modal-save').style.display = 'none';
        localFiles.clear(); 
        el('upload-buttons').style.display = 'none'; 
        el('file-preview-list').innerHTML = "";
        fetchProjects(); 
        setView('view-projects'); 
        showToast("Uploaded!");
    }
};

el('btn-cloud-update').onclick = async () => {
    if(!currentId) return;
    const { error } = await client.from('projects').update({
        html: el('edit-html').value, 
        css: el('edit-css').value, 
        js: el('edit-js').value, 
        updated_at: new Date()
    }).eq('id', currentId);
    if(error) showToast(error.message, true);
    else showToast("Synced!");
};

// Local File Handling
el('file-input').onchange = async (e) => {
    localFiles.clear();
    for (let f of e.target.files) {
        const text = await f.text();
        const ext = f.name.split('.').pop().toLowerCase();
        if(['html', 'css', 'js'].includes(ext)) localFiles.set(ext, text);
    }
    if(localFiles.size > 0) {
        el('upload-buttons').style.display = 'flex';
        el('file-preview-list').innerHTML = Array.from(localFiles.keys()).map(k => `✓ ${k.toUpperCase()} loaded`).join('<br>');
    }
};

// Preview Function
function runPreview(html = '', css = '', js = '') {
    const frame = el('preview-frame');
    // Ensure relative paths don't break by providing a base
    const fullHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>${css}</style>
    </head>
    <body>
        ${html}
        <script>${js}<\/script>
    </body>
    </html>`;
    
    const blob = new Blob([fullHtml], { type: 'text/html' });
    frame.src = URL.createObjectURL(blob);
    setView('view-preview');
}

// UI Navigation Listeners
el('btn-save-trigger').onclick = () => el('modal-save').style.display = 'flex';
el('btn-cancel-save').onclick = () => el('modal-save').style.display = 'none';
el('btn-view-projects').onclick = () => setView('view-projects');
el('btn-back-dashboard').onclick = () => setView('view-dashboard');
el('btn-exit-editor').onclick = () => setView('view-projects');
el('btn-close-preview').onclick = () => {
    if(isSharedView) {
        // If they try to go back from a shared link, just refresh to main app
        window.location.href = window.location.origin + window.location.pathname;
    } else {
        setView('view-editor');
    }
};
el('btn-run-code').onclick = () => {
    el('preview-header').style.display = 'flex';
    runPreview(el('edit-html').value, el('edit-css').value, el('edit-js').value);
};
el('btn-open-editor').onclick = () => {
    currentId = null;
    el('edit-html').value = localFiles.get('html') || ''; 
    el('edit-css').value = localFiles.get('css') || ''; 
    el('edit-js').value = localFiles.get('js') || '';
    setView('view-editor');
};

// Tab Control
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        ['html', 'css', 'js'].forEach(t => el('edit-' + t).style.display = t === tab ? 'block' : 'none');
    };
});

init();
