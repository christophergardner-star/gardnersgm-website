(function() {
    'use strict';

    const GAS = 'https://script.google.com/macros/s/AKfycbx-q2qSeCorIEeXPE9d2MgAZLKEFwFNW9lARLE1yYciH9wJWwvktUTuDVLz_rSCbUhkMg/exec';

    const form = document.getElementById('complaintForm');
    if (!form) return;

    const typeSelect = document.getElementById('complaintType');
    const subscriberFields = document.getElementById('subscriberFields');
    const photoInput = document.getElementById('complaintPhotos');
    const photoDropzone = document.getElementById('photoDropzone');
    const photoPreviews = document.getElementById('photoPreviews');
    const submitBtn = document.getElementById('submitComplaintBtn');

    let selectedPhotos = [];

    // ── Toggle subscriber fields ──
    typeSelect.addEventListener('change', function() {
        subscriberFields.style.display = this.value === 'subscriber' ? 'block' : 'none';
    });

    // ── Photo drag & drop ──
    photoDropzone.addEventListener('click', () => photoInput.click());
    photoDropzone.addEventListener('dragover', e => { e.preventDefault(); photoDropzone.classList.add('dragover'); });
    photoDropzone.addEventListener('dragleave', () => photoDropzone.classList.remove('dragover'));
    photoDropzone.addEventListener('drop', e => {
        e.preventDefault();
        photoDropzone.classList.remove('dragover');
        handlePhotos(e.dataTransfer.files);
    });
    photoInput.addEventListener('change', e => handlePhotos(e.target.files));

    function handlePhotos(files) {
        const maxPhotos = 3;
        const maxSize = 5 * 1024 * 1024; // 5MB

        Array.from(files).forEach(file => {
            if (selectedPhotos.length >= maxPhotos) {
                alert('Maximum 3 photos allowed');
                return;
            }
            if (file.size > maxSize) {
                alert(file.name + ' is too large (max 5MB)');
                return;
            }
            if (!file.type.startsWith('image/')) {
                alert(file.name + ' is not an image');
                return;
            }
            selectedPhotos.push(file);
        });
        renderPreviews();
    }

    function renderPreviews() {
        photoPreviews.innerHTML = '';
        selectedPhotos.forEach((file, i) => {
            const div = document.createElement('div');
            div.className = 'photo-preview';
            const reader = new FileReader();
            reader.onload = e => {
                div.innerHTML = `
                    <img src="${e.target.result}" alt="Photo ${i + 1}">
                    <button type="button" class="remove-photo" data-index="${i}">&times;</button>
                    <span class="photo-name">${file.name}</span>
                `;
                div.querySelector('.remove-photo').addEventListener('click', () => {
                    selectedPhotos.splice(i, 1);
                    renderPreviews();
                });
            };
            reader.readAsDataURL(file);
            photoPreviews.appendChild(div);
        });
    }

    // ── Convert file to base64 ──
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ── Form Submit ──
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        if (!document.getElementById('complaintConsent').checked) {
            alert('Please confirm the information is accurate.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';

        try {
            // Convert photos to base64
            const photoData = [];
            for (const photo of selectedPhotos) {
                const base64 = await fileToBase64(photo);
                photoData.push({
                    name: photo.name,
                    type: photo.type,
                    data: base64
                });
            }

            const payload = {
                action: 'submit_complaint',
                complaintType: typeSelect.value,
                name: document.getElementById('complaintName').value.trim(),
                email: document.getElementById('complaintEmail').value.trim(),
                phone: document.getElementById('complaintPhone').value.trim(),
                jobRef: document.getElementById('complaintJobRef').value.trim(),
                package: document.getElementById('complaintPackage').value,
                subscriptionId: document.getElementById('complaintSubId').value.trim(),
                service: document.getElementById('complaintService').value,
                serviceDate: document.getElementById('complaintDate').value,
                severity: document.getElementById('complaintSeverity').value,
                description: document.getElementById('complaintDescription').value.trim(),
                desiredResolution: document.getElementById('complaintResolution').value,
                amountPaid: document.getElementById('complaintAmount').value,
                photos: photoData
            };

            const response = await fetch(GAS, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.status === 'success') {
                document.getElementById('complaintFormWrapper').style.display = 'none';
                document.getElementById('complaintSuccess').style.display = 'block';
                document.getElementById('complaintRef').textContent = result.complaintRef || 'CMP-' + Date.now();
                window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                throw new Error(result.message || 'Submission failed');
            }
        } catch(err) {
            alert('Error submitting complaint: ' + err.message + '. Please try again or call 01726 432051.');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Submit Complaint';
        }
    });

})();
