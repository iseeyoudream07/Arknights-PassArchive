/* 独立开屏的生命周期、跳过操作与偏好行为回归。
 * 使用项目现有 npm test 运行；本文件不连接线上账号数据库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootMotion } from '../src/vendor/rhine-full/boot-motion.ts';
import { doctorIdentity } from '../src/account-identity.ts';
const frame = (f: number) => bootMotion(f / 25 - 5 + 0.000001);
test('ported opening preserves source phase boundaries, phrase cues and white exit', () => {
    assert.equal(frame(187).access, 'ACCESS PERMISSION REQUIRED');
    assert.equal(frame(255).logoLetters, 'RHINE·LAB');
    assert.equal(frame(339).auth, 'ID CONFIRMED : DOCTOR');
    assert.equal(frame(390).auth, 'REQUEST RECEIVED');
    assert.equal(frame(450).auth, 'START PROCESSING.');
    assert.equal(frame(486).scanVisible, false);
    assert.equal(frame(487).scanVisible, true);
    assert.equal(frame(568).welcomeVisible, false);
    assert.equal(frame(569).welcomeVisible, true);
    assert.equal(frame(673).white, 1);
    assert.equal(frame(673).welcomeOpacity, 0);
});
test('identity follows the current account while retaining the original reveal and phase timing', () => {
    assert.equal(doctorIdentity(false, 'someone'), 'DOCTOR');
    assert.equal(doctorIdentity(true, null), 'DOCTOR');
    assert.equal(doctorIdentity(true, '<script>name</script>'), 'DOCTOR');
    const identity = doctorIdentity(true, 'doctor_archive_01234567890123456');
    assert.equal(identity, 'DR.doctor_archive_01234567890123456');
    const at = (f: number) => bootMotion(f / 25 - 5 + .000001, identity);
    assert.equal(at(320).auth, 'ID CONFIRMED : ');
    assert.equal(at(321).auth, 'ID CONFIRMED : D');
    assert.equal(at(339).auth, `ID CONFIRMED : ${identity}`);
    assert.equal(at(390).auth, 'REQUEST RECEIVED');
});
test('every source frame has finite SVG geometry and valid opacity through the exit', () => {
    const finite = (value: unknown, path: string) => {
        if (typeof value === 'number')
            assert.ok(Number.isFinite(value), path);
        else if (value && typeof value === 'object')
            for (const [key, child] of Object.entries(value))
                finite(child, `${path}.${key}`);
    };
    for (let f = 169; f <= 673; f++) {
        const motion = frame(f);
        finite(motion, `frame ${f}`);
        for (const key of ['accessOpacity', 'logoOpacity', 'authOpacity', 'welcomeOpacity', 'backgroundOpacity', 'white'] as const)
            assert.ok(motion[key] >= 0 && motion[key] <= 1, `frame ${f}: ${key}`);
    }
});
