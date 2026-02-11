/* ============================================
   Gardners Ground Maintenance — Careers Page JS
   Loads vacancies, handles CV upload & application
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    const GAS = 'https://script.google.com/macros/s/AKfycbxMOG1s0F2rUG3EBdaJ1R1x1ofkHjyYqxoBaKTZKVnpvr2g_o2NYSySXU6d8EKkdb0ayg/exec';

    const loadingEl = document.getElementById('careersLoading');
    const vacanciesEl = document.getElementById('careersVacancies');
    const emptyEl = document.getElementById('careersEmpty');
    const positionSelect = document.getElementById('careerPosition');
    const form = document.getElementById('careersForm');
    const submitBtn = document.getElementById('careerSubmitBtn');
    const successEl = document.getElementById('careerSuccess');

    // CV upload state
    let cvFile = null;
    const cvInput = document.getElementById('careerCV');
    const dropzone = document.getElementById('careerCVDropzone');
    const preview = document.getElementById('careerCVPreview');
    const cvNameEl = document.getElementById('careerCVName');
    const removeBtn = document.getElementById('careerCVRemove');


    // ============================================
    // LOAD VACANCIES
    // ============================================

    async function loadVacancies() {
        loadingEl.style.display = 'flex';
        vacanciesEl.style.display = 'none';
        emptyEl.style.display = 'none';

        try {
            const resp = await fetch(GAS + '?action=get_vacancies');
            const data = await resp.json();

            if (data.status === 'success' && data.vacancies && data.vacancies.length > 0) {
                renderVacancies(data.vacancies);
                populatePositionDropdown(data.vacancies);
            } else {
                emptyEl.style.display = 'block';
            }
        } catch (e) {
            console.error('Failed to load vacancies:', e);
            emptyEl.style.display = 'block';
        }

        loadingEl.style.display = 'none';
    }

    function renderVacancies(vacancies) {
        vacanciesEl.innerHTML = vacancies.map(v => {
            const closing = v.closingDate ? new Date(v.closingDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
            const posted = v.postedDate ? new Date(v.postedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

            return `
                <div class="careers-vacancy-card fade-in">
                    <div class="careers-vacancy-header">
                        <h3>${esc(v.title)}</h3>
                        <span class="careers-vacancy-type">${esc(v.type)}</span>
                    </div>
                    <div class="careers-vacancy-meta">
                        ${v.location ? `<span><i class="fas fa-map-marker-alt"></i> ${esc(v.location)}</span>` : ''}
                        ${v.salary ? `<span><i class="fas fa-pound-sign"></i> ${esc(v.salary)}</span>` : ''}
                        ${posted ? `<span><i class="fas fa-calendar"></i> Posted ${posted}</span>` : ''}
                        ${closing ? `<span><i class="fas fa-clock"></i> Closes ${closing}</span>` : ''}
                    </div>
                    ${v.description ? `<div class="careers-vacancy-desc">${esc(v.description)}</div>` : ''}
                    ${v.requirements ? `<div class="careers-vacancy-reqs"><strong>Requirements:</strong> ${esc(v.requirements)}</div>` : ''}
                    <a href="#apply" class="btn btn-primary btn-sm" onclick="document.getElementById('careerPosition').value='${esc(v.title)}';">
                        <i class="fas fa-paper-plane"></i> Apply for this role
                    </a>
                </div>
            `;
        }).join('');

        vacanciesEl.style.display = 'block';
    }

    function populatePositionDropdown(vacancies) {
        // Remove old dynamic options
        const opts = positionSelect.querySelectorAll('option[data-dynamic]');
        opts.forEach(o => o.remove());

        vacancies.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.title;
            opt.textContent = v.title;
            opt.setAttribute('data-dynamic', 'true');
            // Insert before "Speculative Application"
            const specOpt = positionSelect.querySelector('option[value="Speculative Application"]');
            positionSelect.insertBefore(opt, specOpt);
        });
    }

    function esc(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }


    // ============================================
    // CV UPLOAD — Drag & Drop + Click
    // ============================================

    dropzone.addEventListener('click', () => cvInput.click());

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleCVFile(e.dataTransfer.files[0]);
        }
    });

    cvInput.addEventListener('change', () => {
        if (cvInput.files.length) {
            handleCVFile(cvInput.files[0]);
        }
    });

    removeBtn.addEventListener('click', () => {
        cvFile = null;
        cvInput.value = '';
        dropzone.style.display = 'flex';
        preview.style.display = 'none';
    });

    function handleCVFile(file) {
        const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        const maxSize = 5 * 1024 * 1024; // 5MB

        if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|doc|docx)$/i)) {
            alert('Please upload a PDF, DOC or DOCX file.');
            return;
        }

        if (file.size > maxSize) {
            alert('File is too large. Maximum size is 5MB.');
            return;
        }

        cvFile = file;
        cvNameEl.textContent = file.name + ' (' + (file.size / 1024).toFixed(0) + ' KB)';

        // Icon based on type
        const iconEl = preview.querySelector('i');
        if (file.name.endsWith('.pdf')) {
            iconEl.className = 'fas fa-file-pdf';
        } else {
            iconEl.className = 'fas fa-file-word';
        }

        dropzone.style.display = 'none';
        preview.style.display = 'flex';
    }

    /**
     * Convert file to base64 string
     */
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Remove data URL prefix to get raw base64
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }


    // ============================================
    // FORM SUBMISSION
    // ============================================

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Validate required fields
        const firstName = document.getElementById('careerFirstName').value.trim();
        const lastName = document.getElementById('careerLastName').value.trim();
        const email = document.getElementById('careerEmail').value.trim();
        const phone = document.getElementById('careerPhone').value.trim();
        const postcode = document.getElementById('careerPostcode').value.trim();
        const position = positionSelect.value;
        const licence = document.getElementById('careerLicence').value;
        const consent = document.getElementById('careerConsent').checked;
        const availableFrom = document.getElementById('careerAvailableFrom').value;

        if (!position || !firstName || !lastName || !email || !phone || !postcode || !licence || !availableFrom) {
            alert('Please fill in all required fields.');
            return;
        }

        if (!consent) {
            alert('Please tick the consent checkbox to submit your application.');
            return;
        }

        // Show loading state
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

        try {
            // Build payload
            const payload = {
                action: 'submit_application',
                position: position,
                firstName: firstName,
                lastName: lastName,
                email: email,
                phone: phone,
                postcode: postcode,
                dob: document.getElementById('careerDOB').value || '',
                availableFrom: availableFrom,
                preferredHours: document.getElementById('careerHours').value,
                drivingLicence: licence,
                ownTransport: document.getElementById('careerTransport').value,
                experience: document.getElementById('careerExperience').value.trim(),
                qualifications: document.getElementById('careerQualifications').value.trim(),
                message: document.getElementById('careerMessage').value.trim()
            };

            // CV as base64
            if (cvFile) {
                payload.cvBase64 = await fileToBase64(cvFile);
                payload.cvName = cvFile.name;
            }

            const resp = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

            const result = await resp.json();

            if (result.status === 'success') {
                form.style.display = 'none';
                successEl.style.display = 'block';
                successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                alert('Something went wrong: ' + (result.message || 'Please try again.'));
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Application';
            }
        } catch (err) {
            console.error('Application submit error:', err);
            alert('Could not submit your application. Please check your connection and try again.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Application';
        }
    });


    // ============================================
    // INIT
    // ============================================

    loadVacancies();

});
